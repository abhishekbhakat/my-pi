import { spawn } from "node:child_process";
import { appendFileSync, rmSync, openSync, closeSync, readFileSync, writeFileSync, writeSync } from "node:fs";
import * as path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { repairCoderTranscript } from "#capability-snapshot";
import { coderEvent, type CoderChannel } from "#capability-coder-progress";

export interface CoderRpcOptions {
	cwd: string;
	model: string;
	thinking: string;
	task: string;
	directory: string;
	signal: AbortSignal;
	channel?: CoderChannel;
	executable?: string;
}
export const CHILD_TOOLS = "read,bash,edit,write,grep,find,ls,tree,jobs,yolo,codemode";

async function coderRpcAttempt(options: CoderRpcOptions, recovery: CoderRecovery): Promise<string> {
	const { directory, signal, channel } = options;
	const inventory = path.join(directory, "tool-preflight.json");
	rmSync(inventory, { force: true });
	const preflight = path.join(directory, "tool-preflight.mjs");
	writeFileSync(preflight, `import { writeFileSync } from "node:fs";
export default function (pi) {
  pi.on("session_start", () => writeFileSync(${JSON.stringify(inventory)}, JSON.stringify(pi.getActiveTools()), { mode: 0o600 }));
  pi.on("tool_call", (event) => {
    if (event.toolName === "bash" && (event.input.timeout === undefined || event.input.timeout < 180)) event.input.timeout = 180;
  });
}`, { mode: 0o600 });
	if (signal.aborted) throw new Error("Coder cancelled before launch.");
	const stdout = openSync(path.join(directory, "stdout.jsonl"), "a", 0o600);
	const errorFile = path.join(directory, "stderr.txt");
	const stderr = openSync(errorFile, "a", 0o600);
	let text = "";
	try {
		await new Promise<void>((resolve, reject) => {
			let settled = false;
			let closing = false;
			let stopped = false;
			let resuming = false;
			let interrupting = false;
			let controls = 0;
			let controlQueue: Promise<unknown> = Promise.resolve();
			let stopReason: string | undefined;
			let failure: string | undefined;
			let modelFailure: string | undefined;
			let sequence = 0;
			let buffer = "";
			const decoder = new StringDecoder("utf8");
			const pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }>();
			const instructions = new Map<string, string>();
			const update: CoderChannel["update"] = (value) => channel?.update(value);
			const child = spawn(options.executable ?? "pi", [
				"--mode", "rpc", "--session", path.join(directory, "session.jsonl"),
				"--model", options.model, "--thinking", options.thinking,
				"--system-prompt", path.join(directory, "system.md"), "--tools", CHILD_TOOLS, "--no-mcp",
				"--extension", preflight,
			], {
				cwd: options.cwd, env: { ...process.env, PI_CAPABILITY_CHILD: "1" },
				stdio: ["pipe", "pipe", stderr], detached: process.platform !== "win32",
			});
			const finish = () => {
				if (closing || !settled || pending.size || controls) return;
				if (instructions.size && !resuming) {
					resuming = true;
					void request({ type: "get_state" }).then(async (state) => {
						if (controls) { resuming = false; return; }
						if (state.isStreaming) { settled = false; return; }
						if (!state.pendingMessageCount) throw new Error("Instruction delivery unconfirmed; coder queue is empty.");
						update({ phase: "instruction queued", text: "Resuming coder to consume queued instructions." });
						await request({ type: "prompt", message: "Process queued parent instructions before finalizing.", streamingBehavior: "steer" });
					}).catch(fail);
					return;
				}
				if (instructions.size) failure = "Coder settled before confirming delivery of additional instructions.";
				closing = true;
				channel?.attach(undefined);
				child.stdin?.end();
				child.kill("SIGTERM");
			};
			const fail = (error: Error) => {
				failure = error.message;
				closing = true;
				channel?.attach(undefined);
				child.kill("SIGTERM");
			};
			const write = (record: object) => {
				if (stopped || !child.stdin?.writable) throw new Error("Coder control channel closed.");
				child.stdin.write(JSON.stringify(record) + "\n", (error) => { if (error) fail(error); });
			};
			const request = (record: Record<string, unknown>): Promise<any> => {
				if (closing || stopped || signal.aborted) return Promise.reject(new Error("Coder is stopping or finished."));
				const id = `coder-${++sequence}`;
				return new Promise((accept, decline) => {
					pending.set(id, { resolve: accept, reject: decline });
					try { write({ ...record, id }); }
					catch (error) { pending.delete(id); decline(error as Error); }
				});
			};
			const cancel = () => {
				closing = true;
				channel?.attach(undefined);
				child.kill("SIGTERM");
			};
			const record = (event: Record<string, any>) => {
				if (event.type === "response") {
					const waiter = pending.get(event.id);
					if (!waiter) return;
					pending.delete(event.id);
					if (event.success) {
						// A new prompt accepted after a settle starts another run.
						if (event.command === "prompt" && event.data?.disposition === "started") settled = false;
						waiter.resolve(event.data);
					} else waiter.reject(new Error(event.error ?? "Coder command rejected."));
					queueMicrotask(finish);
					return;
				}
				if (event.type === "extension_ui_request") {
					if (["confirm", "select", "input", "editor"].includes(event.method)) {
						update({ phase: "blocked", text: `Approval/input required: ${event.title ?? event.method}. ${event.message ?? ""} Denied in coder; ask parent to handle.` });
						write({ type: "extension_ui_response", id: event.id, cancelled: true, confirmed: false });
					}
					return;
				}
				if (event.type === "tool_execution_start") recovery.toolsExecuted++;
				if (event.type === "agent_start") { settled = false; stopReason = undefined; modelFailure = undefined; }
				if (event.type === "message_start" && event.message?.role === "user") {
					const content = typeof event.message.content === "string" ? event.message.content :
						(event.message.content ?? []).filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n");
					for (const [id, message] of instructions) {
						if (content.includes(`[parent-instruction ${id}]`)) { instructions.delete(id); resuming = false; update({ phase: "instruction delivered", text: message }); }
					}
				}
				coderEvent(event, update);
				if (event.type === "message_end" && event.message?.role === "assistant") {
					stopReason = event.message.stopReason;
					text = (event.message.content ?? []).filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n").trim();
					writeFileSync(path.join(directory, "report.txt"), text, { mode: 0o600 });
					modelFailure = event.message.errorMessage;
					if (modelFailure) update({ phase: classifyCoderError(modelFailure), text: modelFailure });
				}
				if (event.type === "agent_settled") {
					settled = true;
					if (event.aborted && !signal.aborted && !interrupting) failure = "Coder run aborted.";
					finish();
				}
			};
			child.stdin?.on("error", fail);
			child.stdout?.on("data", (chunk: Buffer) => {
				try {
					writeSync(stdout, chunk);
					buffer += decoder.write(chunk);
					let cut: number;
					while ((cut = buffer.indexOf("\n")) >= 0) {
						const line = buffer.slice(0, cut).replace(/\r$/, "");
						buffer = buffer.slice(cut + 1);
						if (line.trim()) record(JSON.parse(line));
					}
				} catch (error) { fail(new Error(`Coder event failure: ${String(error)}`)); }
			});
			child.once("error", fail);
			child.once("close", (code, exitSignal) => {
				stopped = true;
				signal.removeEventListener("abort", cancel);
				channel?.attach(undefined);
				for (const waiter of pending.values()) waiter.reject(new Error("Coder exited before acknowledging command."));
				pending.clear();
				if (signal.aborted) { reject(new Error("Coder cancelled. Workspace edits remain on disk.")); return; }
				if (failure || modelFailure || !settled || stopReason !== "stop" || !text || !(code === 0 || code === 143 || exitSignal === "SIGTERM")) {
					reject(new Error(`${failure ?? modelFailure ?? `Coder incomplete: settled=${settled}, stopReason=${stopReason}, exit=${code ?? exitSignal}`}. ${readFileSync(errorFile, "utf8").slice(-4000)} See ${directory}`));
				} else resolve();
			});
			signal.addEventListener("abort", cancel, { once: true });
			if (signal.aborted) { cancel(); return; }
			update({ phase: "starting", text: `Connecting to ${options.model} (${options.thinking}).` });
			const started = request({ type: "get_state" }).then(state => {
				if (state.model?.provider + "/" + state.model?.id !== options.model) throw new Error("[tool-missing] Coder model selection did not resolve: " + options.model);
				const active = new Set<string>(JSON.parse(readFileSync(inventory, "utf8")));
				const missing = CHILD_TOOLS.split(",").filter(name => !active.has(name));
				if (missing.length) throw new Error("[tool-missing] Coder missing tools: " + missing.join(", "));
				return request({ type: "prompt", message: `Delegated coding task:\n\n${options.task}` });
			});
			started.then((data) => { if (data?.disposition === "handled") fail(new Error("Coder task consumed without starting a run.")); }).catch(fail);
			channel?.attach((message, interrupt = false) => {
				recovery.steered = true;
				controls++;
				const operation = controlQueue.then(async () => {
					await started;
					if (closing || stopped || signal.aborted) throw new Error("Coder is stopping or finished.");
					const key = `instruction-${++sequence}`;
					const directive = `[parent-instruction ${key}]\nAdditional instructions from parent:\n\n${message}`;
					instructions.set(key, directive);
					update({ phase: interrupt ? "interrupting" : "instruction sending", text: message });
					try {
						let prompt = directive;
						let active = false;
						if (interrupt) {
							interrupting = true;
							active = (await request({ type: "get_state" })).isStreaming;
							const queued = await request({ type: "clear_queue" });
							await request({ type: "abort_bash" });
							await request({ type: "abort" });
							failure = modelFailure = stopReason = undefined;
							text = "";
							prompt = [...(queued?.steering ?? []), ...(queued?.followUp ?? []),
								"Parent interrupted the previous turn. Do not rerun interrupted commands unless the latest instruction asks for it.", directive].join("\n\n");
						}
						const data = await request({ type: "prompt", message: prompt, ...(interrupt ? {} : { streamingBehavior: "steer" }) });
						if (data?.disposition === "handled") throw new Error("Instruction consumed without reaching coder.");
						if (instructions.has(key)) update({ phase: "instruction queued", text: message });
						return `${interrupt ? active ? "Coder turn interrupted. " : "Nothing to interrupt. " : ""}Instruction ${instructions.has(key) ? "queued for next tool boundary" : "delivered"}.`;
					} catch (error) {
						instructions.delete(key);
						update({ phase: "instruction rejected", text: String(error) });
						if (interrupt) fail(new Error(`Coder interrupt failed: ${String(error)}`));
						throw error;
					} finally { interrupting = false; }
				}).finally(() => { controls--; queueMicrotask(finish); });
				controlQueue = operation.catch(() => undefined);
				return operation;
			});
		});
	} finally { closeSync(stdout); closeSync(stderr); }
	return text;
}

export type CoderErrorClass = "transcript" | "auth" | "tool-missing" | "transient" | "unknown";
interface CoderRecovery {
	errorClass: CoderErrorClass | "none";
	repairCount: number;
	retryCount: number;
	toolsExecuted: number;
	steered: boolean;
}

export function classifyCoderError(message: string): CoderErrorClass {
	if (/no tool call found for function call output|tool_use\s*ids|\[transcript\]/i.test(message)) return "transcript";
	if (/expired|oauth|invalid_api_key|\b401\b/i.test(message)) return "auth";
	if (/\[tool-missing\]|unknown tool|tool .*not (?:found|available)|missing tools/i.test(message)) return "tool-missing";
	if (/\b429\b|\b5\d\d\b|ECONNRESET/i.test(message)) return "transient";
	return "unknown";
}

export function canRetryCoder(errorClass: CoderErrorClass, recovery: Pick<CoderRecovery, "toolsExecuted" | "retryCount" | "steered">): boolean {
	return recovery.toolsExecuted === 0 && recovery.retryCount === 0 && !recovery.steered &&
		(errorClass === "transcript" || errorClass === "transient");
}

/** Only retry before any tool execution or steering; restore the same repaired seed. */
export async function coderRpc(options: CoderRpcOptions): Promise<string> {
	const recovery: CoderRecovery = { errorClass: "none", repairCount: 0, retryCount: 0, toolsExecuted: 0, steered: false };
	const sessionFile = path.join(options.directory, "session.jsonl");
	const record = (message: string) => {
		writeFileSync(path.join(options.directory, "recovery.json"), JSON.stringify(recovery, null, 2), { mode: 0o600 });
		appendFileSync(path.join(options.directory, "progress.log"), `\n[recovery] ${message}\n`, { mode: 0o600 });
		options.channel?.update({ phase: "recovery", text: message });
	};
	try {
		if (options.signal.aborted) throw new Error("Coder cancelled before launch.");
		const rows = readFileSync(sessionFile, "utf8").trim().split("\n").map(line => JSON.parse(line));
		const audit = rows.filter(row => row.type === "custom" && row.customType === "coder-transcript-repairs").at(-1);
		recovery.repairCount = audit?.data?.repairCount ?? 0;
		const prepare = () => {
			const fixed = repairCoderTranscript(rows.slice(1), true);
			recovery.repairCount += fixed.repairCount;
			const seed = [rows[0], ...fixed.entries].map(row => JSON.stringify(row)).join("\n") + "\n";
			writeFileSync(sessionFile, seed, { mode: 0o600 });
			appendFileSync(path.join(options.directory, "transcript-repairs.jsonl"), JSON.stringify({
				retryCount: recovery.retryCount, repairCount: recovery.repairCount,
				repairs: [...(audit?.data?.repairs ?? []), ...fixed.repairs],
			}) + "\n", { mode: 0o600 });
			return seed;
		};
		let seed = prepare();
		record(`preflight: repairs=${recovery.repairCount}, retries=0`);
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				const text = await coderRpcAttempt(options, recovery);
				record(`done: class=${recovery.errorClass}, repairs=${recovery.repairCount}, retries=${recovery.retryCount}, tools=${recovery.toolsExecuted}`);
				return text;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				recovery.errorClass = classifyCoderError(message);
				record(`error: class=${recovery.errorClass}, repairs=${recovery.repairCount}, retries=${recovery.retryCount}, tools=${recovery.toolsExecuted}`);
				if (options.signal.aborted || !canRetryCoder(recovery.errorClass, recovery)) throw error;
				recovery.retryCount++;
				if (recovery.errorClass === "transcript") seed = prepare();
				else writeFileSync(sessionFile, seed, { mode: 0o600 });
				record(`retry ${recovery.retryCount}: ${recovery.errorClass}, same model ${options.model}`);
			}
		}
		throw new Error("Coder retry budget spent.");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		recovery.errorClass = classifyCoderError(message);
		const hint = recovery.errorClass === "auth" ? " Re-authenticate the provider or pin a working model in userprofile.json capabilities.coder." : "";
		const failure = `[${recovery.errorClass}] ${message}${hint} repairs=${recovery.repairCount}, retries=${recovery.retryCount}, tools=${recovery.toolsExecuted}`;
		record(failure);
		writeFileSync(path.join(options.directory, "result.txt"), failure, { mode: 0o600 });
		throw new Error(failure);
	}
}
