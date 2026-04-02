import { spawn, execSync } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import type { AgentInstance, SpawnCallbacks, SpawnOptions } from "./types";

/** Extensions to load into sub-agents (whitelisted, not auto-discovered) */
const SUB_AGENT_EXTENSIONS = [
	"cocoindex-code",
	"tree-tool",
	"bash-override",
	"damage-control",
];

function killProc(proc: ChildProcessWithoutNullStreams): void {
	if (!proc.pid) return;
	if (process.platform === "win32") {
		// On Windows with shell: true, SIGTERM only kills the shell wrapper.
		// Use taskkill /T to kill the entire process tree.
		try {
			execSync(`taskkill /F /T /PID ${proc.pid}`, { stdio: "ignore" });
		} catch {}
	} else {
		proc.kill("SIGTERM");
	}
}

let dirCreated = false;

export function makeSessionFile(agentName: string, id: number): string {
	const dir = path.join(os.homedir(), ".pi", "agent", "sessions", "widgets");
	if (!dirCreated) {
		fs.mkdirSync(dir, { recursive: true });
		dirCreated = true;
	}
	const timestamp = Date.now();
	const random = Math.random().toString(36).substring(2, 8);
	return path.join(dir, `${agentName.toLowerCase().replace(/\s+/g, "-")}-${id}-${timestamp}-${random}.jsonl`);
}

export function getInstanceKey(agentName: string, id: number): string {
	return `${agentName.toLowerCase()}:${id}`;
}

export function spawnAgentInstance(
	inst: AgentInstance,
	prompt: string,
	callbacks: SpawnCallbacks,
	opts?: SpawnOptions
): Promise<string> {
	const signal = opts?.signal;

	return new Promise<string>((resolve) => {
		const isWindows = process.platform === "win32";
		const extensionsDir = path.join(os.homedir(), ".pi", "agent", "extensions");

		const args: string[] = [
			"--mode", "json",
			"-p",
			"--session", inst.sessionFile,
			"--no-extensions",
		];

		for (const ext of SUB_AGENT_EXTENSIONS) {
			const extPath = path.join(extensionsDir, ext, "index.ts");
			const altPath = path.join(extensionsDir, `${ext}.ts`);
			if (fs.existsSync(extPath)) {
				args.push("--extension", extPath);
			} else if (fs.existsSync(altPath)) {
				args.push("--extension", altPath);
			}
		}

		args.push(
			"--model", inst.def.model,
			"--tools", inst.def.tools,
			"--thinking", "off",
			"--append-system-prompt", inst.def.systemPrompt,
			prompt,
		);

		const command = isWindows
			? process.execPath
			: "pi";
		const spawnArgs = isWindows
			? [path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "npm", "node_modules", "@mariozechner", "pi-coding-agent", "dist", "cli.js"), ...args]
			: args;

		const proc = spawn(command, spawnArgs, {
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env },
			shell: false,
		});

		inst.proc = proc;

		if (signal) {
			const onAbort = () => {
				if (inst.proc) {
					killProc(inst.proc);
				}
			};
			if (signal.aborted) {
				killProc(proc);
			} else {
				signal.addEventListener("abort", onAbort, { once: true });
				proc.on("close", () => signal.removeEventListener("abort", onAbort));
			}
		}

		const startTime = Date.now();
		const timer = setInterval(() => {
			inst.elapsed = Date.now() - startTime;
		}, 1000);

		let buffer = "";

		proc.stdout!.setEncoding("utf-8");
		proc.stdout!.on("data", (chunk: string) => {
			buffer += chunk;
			const lines = buffer.split("\n");
			buffer = lines.pop() || "";
			for (const line of lines) processLine(inst, line, callbacks);
		});

		proc.stderr!.setEncoding("utf-8");
		proc.stderr!.on("data", (chunk: string) => {
			if (chunk.trim()) {
				inst.textChunks.push(chunk);
				callbacks.onTextDelta(chunk);
			}
		});

		proc.on("close", (code) => {
			if (buffer.trim()) processLine(inst, buffer, callbacks);
			clearInterval(timer);
			inst.elapsed = Date.now() - startTime;
			inst.status = code === 0 ? "done" : "error";
			inst.proc = undefined;
			callbacks.onStatusChange(inst.status, inst.elapsed);

			const result = inst.textChunks.join("");
			resolve(result);
		});

		proc.on("error", (err) => {
			clearInterval(timer);
			inst.status = "error";
			inst.proc = undefined;
			inst.textChunks.push(`Error: ${err.message}`);
			callbacks.onStatusChange("error", inst.elapsed);
			resolve(`Error: ${err.message}`);
		});
	});
}

function processLine(inst: AgentInstance, line: string, callbacks: SpawnCallbacks) {
	if (!line.trim()) return;
	try {
		const event = JSON.parse(line);
		const type = event.type;

		if (type === "message_update") {
			const delta = event.assistantMessageEvent;
			if (delta?.type === "text_delta") {
				inst.textChunks.push(delta.delta || "");
				callbacks.onTextDelta(delta.delta || "");
			}
		} else if (type === "tool_execution_start") {
			inst.toolCount++;
			callbacks.onToolStart();
		}
	} catch {}
}
