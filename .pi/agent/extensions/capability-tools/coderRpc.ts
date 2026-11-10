import { spawn } from "node:child_process";
import { openSync, closeSync, readFileSync, writeFileSync, writeSync } from "node:fs";
import * as path from "node:path";
import { StringDecoder } from "node:string_decoder";
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
const CHILD_TOOLS = "read,bash,edit,write,grep,find,ls,tree,jobs,yolo,codemode";

export async function coderRpc(options: CoderRpcOptions): Promise<string> {
	const { directory, signal, channel } = options;
	if (signal.aborted) throw new Error("Coder cancelled before launch.");
	const stdout = openSync(path.join(directory, "stdout.jsonl"), "w", 0o600);
	const errorFile = path.join(directory, "stderr.txt");
	const stderr = openSync(errorFile, "w", 0o600);
	let text = "";
	try {
		await new Promise<void>((resolve, reject) => {
			let settled = false;
			let closing = false;
			let stopped = false;
			let resuming = false;
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
			], {
				cwd: options.cwd, env: { ...process.env, PI_CAPABILITY_CHILD: "1" },
				stdio: ["pipe", "pipe", stderr], detached: process.platform !== "win32",
			});
			const finish = () => {
				if (closing || !settled || pending.size) return;
				if (instructions.size && !resuming) {
					resuming = true;
					void request({ type: "get_state" }).then(async (state) => {
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
				if (event.type === "agent_start") { settled = false; stopReason = undefined; }
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
					if (modelFailure) update({ phase: "model error", text: modelFailure });
				}
				if (event.type === "agent_settled") {
					settled = true;
					if (event.aborted && !signal.aborted) failure = "Coder run aborted.";
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
			const started = request({ type: "prompt", message: `Delegated coding task:\n\n${options.task}` });
			started.then((data) => { if (data?.disposition === "handled") fail(new Error("Coder task consumed without starting a run.")); }).catch(fail);
			channel?.attach(async (message) => {
				await started;
				if (settled || closing || stopped || signal.aborted) throw new Error("Coder is stopping or finished.");
				const key = `instruction-${++sequence}`;
				const directive = `[parent-instruction ${key}]\nAdditional instructions from parent:\n\n${message}`;
				instructions.set(key, directive);
				update({ phase: "instruction sending", text: message });
				try {
					const data = await request({ type: "prompt", message: directive, streamingBehavior: "steer" });
					if (data?.disposition === "handled") throw new Error("Instruction consumed without reaching coder.");
					if (instructions.has(key)) update({ phase: "instruction queued", text: message });
					return `Instruction ${instructions.has(key) ? "queued for next tool boundary" : "delivered"}.`;
				} catch (error) { instructions.delete(key); update({ phase: "instruction rejected", text: String(error) }); throw error; }
			});
		});
	} finally { closeSync(stdout); closeSync(stderr); }
	return text;
}
