import { spawn } from "node:child_process";
import { openSync, closeSync, readFileSync, writeFileSync, writeSync } from "node:fs";
import * as path from "node:path";
import { createInterface } from "node:readline";
import { coderSession, snapshotContext } from "#capability-snapshot";
import type { CapabilityBackground } from "#capability-background";
import type { CapabilityDef, CapabilityToolInput } from "#capability-types";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const CAPABILITY_CHILD_ENV = "PI_CAPABILITY_CHILD";
const CHILD_TOOLS = "read,bash,edit,write,grep,find,ls,tree,jobs,yolo,codemode";

export function startCoder(background: CapabilityBackground, def: CapabilityDef, input: CapabilityToolInput, ctx: ExtensionContext) {
	const snapshot = snapshotContext(ctx);
	const session = coderSession(snapshot.sessionManager.getBranch(), snapshot.cwd);
	const systemPrompt = `${snapshot.getSystemPrompt()}\n\n${def.systemPrompt}`;
	const task = [input.task, input.paths?.length ? `Assigned paths:\n${input.paths.join("\n")}` : ""].filter(Boolean).join("\n\n");
	return background.start("coder", ctx, (signal, directory) => runCoderChild({
		cwd: snapshot.cwd, model: def.model, thinking: def.reasoningEffort ?? "high",
		session, systemPrompt, task, directory, signal,
	}));
}

export interface CoderChildOptions {
	cwd: string;
	model: string;
	thinking: string;
	session: string;
	systemPrompt: string;
	task: string;
	directory: string;
	signal: AbortSignal;
	/** Tests may supply a local executable; production resolves pi on PATH. */
	executable?: string;
}

export async function runCoderChild(options: CoderChildOptions) {
	const { directory, signal } = options;
	if (signal.aborted) throw new Error("Coder cancelled before launch.");
	const sessionFile = path.join(directory, "session.jsonl");
	const promptFile = path.join(directory, "system.md");
	const taskFile = path.join(directory, "task.txt");
	const outputFile = path.join(directory, "stdout.jsonl");
	const reportFile = path.join(directory, "report.txt");
	const errorFile = path.join(directory, "stderr.txt");
	writeFileSync(sessionFile, options.session, { mode: 0o600 });
	writeFileSync(promptFile, options.systemPrompt, { mode: 0o600 });
	writeFileSync(taskFile, options.task, { mode: 0o600 });
	const stdout = openSync(outputFile, "w", 0o600);
	const stderr = openSync(errorFile, "w", 0o600);
	let text = "";
	try {
		await new Promise<void>((resolve, reject) => {
			let settled = false;
			let stopReason: string | undefined;
			let failure: string | undefined;
			let protocolFailure: string | undefined;
			const child = spawn(options.executable ?? "pi", [
				"--mode", "json", "--session", sessionFile, "--model", options.model,
				"--thinking", options.thinking, "--system-prompt", promptFile,
				"--tools", CHILD_TOOLS, "--no-mcp", `@${taskFile}`,
			], {
				cwd: options.cwd, env: { ...process.env, [CAPABILITY_CHILD_ENV]: "1" },
				stdio: ["ignore", "pipe", stderr], detached: process.platform !== "win32",
			});
			const cancel = () => {
				// Pi JSON mode handles SIGTERM by aborting the session and awaiting
				// tool cleanup, then exiting even if a worker holds the event loop.
				child.kill("SIGTERM");
			};
			const output = child.stdout;
			if (!output) { cancel(); reject(new Error("Coder stdout pipe unavailable.")); return; }
			const lines = createInterface({ input: output });
			output.on("data", (chunk) => {
				try { writeSync(stdout, chunk); }
				catch (error) { protocolFailure = `Cannot save coder events: ${String(error)}`; cancel(); }
			});
			lines.on("line", (line) => {
				if (!line.trim()) return;
				try {
					const event = JSON.parse(line);
					if (event.type === "message_end" && event.message?.role === "assistant") {
						stopReason = event.message.stopReason;
						text = (event.message.content ?? [])
							.filter((part: { type: string }) => part.type === "text")
							.map((part: { text: string }) => part.text).join("\n").trim();
						writeFileSync(reportFile, text, { mode: 0o600 });
						failure = event.message.errorMessage;
					}
					if (event.type === "agent_settled") {
						settled = true;
						if (event.aborted) failure = "Coder run aborted.";
						// This boundary follows tools, queued work and automatic recovery.
						// Do not wait for unrelated worker handles to let the CLI exit.
						cancel();
					}
				} catch (error) { protocolFailure = `Invalid coder JSON event: ${String(error)}`; cancel(); }
			});
			signal.addEventListener("abort", cancel, { once: true });
			if (signal.aborted) cancel();
			child.once("error", (error) => { signal.removeEventListener("abort", cancel); lines.close(); reject(error); });
			child.once("close", (code, exitSignal) => {
				signal.removeEventListener("abort", cancel);
				lines.close();
				if (signal.aborted) { reject(new Error("Coder cancelled. Workspace edits already made remain on disk.")); return; }
				const expectedExit = code === 0 || code === 143 || exitSignal === "SIGTERM";
				if (!settled || !expectedExit || protocolFailure || failure || stopReason !== "stop" || !text) {
					reject(new Error(`${protocolFailure ?? failure ?? `Coder incomplete: settled=${settled}, stopReason=${stopReason}, exit=${code ?? exitSignal}`}. ${readFileSync(errorFile, "utf8").slice(-4000)} See ${directory}`));
				} else resolve();
			});
		});
	} finally {
		closeSync(stdout);
		closeSync(stderr);
	}
	return { content: [{ type: "text" as const, text }], details: { status: "done", directory } };
}

export function registerCoderCommand(pi: ExtensionAPI): void {
	pi.registerCommand("coder", {
		description: "Toggle coder tool. Subcommands: on, off, status",
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase();
			const active = pi.getActiveTools();
			const enabled = active.includes("coder");
			if (action === "status") { ctx.ui.notify(`Coder ${enabled ? "enabled" : "disabled"}.`, "info"); return; }
			if (action && !["on", "off", "toggle"].includes(action)) {
				ctx.ui.notify("Use /coder, /coder on, /coder off, or /coder status.", "warning"); return;
			}
			const enable = action === "on" || (action !== "off" && !enabled);
			pi.setActiveTools(enable ? [...new Set([...active, "coder"])] : active.filter((name) => name !== "coder"));
			ctx.ui.notify(`Coder ${enable ? "enabled" : "disabled"}. Existing runs continue; stop with capability_jobs.`, "info");
		},
	});
}
