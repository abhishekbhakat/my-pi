import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type Result = { content: Array<{ type: string; text?: string }>; details?: unknown };
export type BackgroundWork = (signal: AbortSignal, directory: string) => Promise<Result>;
export interface CapabilityRun {
	id: string;
	kind: string;
	sessionId: string;
	status: "running" | "cancelling" | "done" | "error" | "cancelled";
	controller: AbortController;
	directory: string;
	text: string;
	completion?: Promise<void>;
}

export class CapabilityBackground {
	readonly runs = new Map<string, CapabilityRun>();
	private generation = 0;
	private context?: ExtensionContext;

	constructor(private readonly pi: ExtensionAPI) {}

	bind(ctx: ExtensionContext): void { this.context = ctx; }

	async cancelAll(): Promise<void> {
		this.generation++;
		for (const run of this.runs.values()) this.stop(run.id);
		this.context?.ui.setStatus("capability-background", undefined);
		this.context = undefined;
		// Session replacement must wait for writers to stop before a new runtime
		// can start another coder in the same workspace.
		await Promise.allSettled([...this.runs.values()].map((run) => run.completion));
	}

	stop(id: string): void {
		const run = this.runs.get(id);
		if (run?.status !== "running") return;
		run.status = "cancelling";
		run.controller.abort();
		this.paint();
	}

	private paint(): void {
		const count = [...this.runs.values()].filter((run) => run.status === "running" || run.status === "cancelling").length;
		this.context?.ui.setStatus("capability-background", count ? `Capabilities: ${count} running` : undefined);
	}

	start(kind: string, ctx: ExtensionContext, work: BackgroundWork): AgentToolResult {
		if ([...this.runs.values()].filter((run) => run.status === "running" || run.status === "cancelling").length >= 4) {
			throw new Error("At most four background capabilities may run at once.");
		}
		if (kind === "coder" && [...this.runs.values()].some((run) => run.kind === kind && (run.status === "running" || run.status === "cancelling"))) {
			throw new Error("Coder already running. Wait or stop it before starting another workspace writer.");
		}
		this.bind(ctx);
		const id = `${kind}-${randomUUID()}`;
		const directory = path.join(ctx.cwd, ".agents", "capability-runs", id);
		mkdirSync(directory, { recursive: true, mode: 0o700 });
		const ignoreFile = path.join(path.dirname(directory), ".gitignore");
		try { writeFileSync(ignoreFile, "*\n", { flag: "wx", mode: 0o600 }); }
		catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
		const run: CapabilityRun = {
			id, kind, directory, sessionId: ctx.sessionManager.getSessionId(),
			status: "running", controller: new AbortController(), text: "",
		};
		this.runs.set(id, run);
		// Keep the in-memory index bounded; completed output remains on disk.
		for (const [oldId, old] of this.runs) {
			if (this.runs.size <= 50) break;
			if (old.status !== "running" && old.status !== "cancelling") this.runs.delete(oldId);
		}
		const generation = this.generation;
		this.paint();
		run.completion = Promise.resolve().then(() => {
			if (run.controller.signal.aborted) throw new Error("Capability cancelled before launch.");
			return work(run.controller.signal, directory);
		}).then(
			(result) => {
				run.text = result.content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n");
				const status = (result.details as { status?: string } | undefined)?.status;
				run.status = run.controller.signal.aborted ? "cancelled" : status === "error" || status === "aborted" ? "error" : "done";
			},
			(error) => {
				run.text = error instanceof Error ? error.message : String(error);
				run.status = run.controller.signal.aborted ? "cancelled" : "error";
			},
		).then(() => {
			writeFileSync(path.join(directory, "result.txt"), run.text, { mode: 0o600 });
			this.paint();
			const current = this.context;
			if (generation !== this.generation || !current || current.sessionManager.getSessionId() !== run.sessionId) return;
			this.pi.sendMessage({
				customType: "capability_result", display: true,
				content: `${id} ${run.status}. Full result: ${path.join(directory, "result.txt")}\n\n${run.text.slice(-16000)}`,
				details: { id, capability: kind, status: run.status, directory },
			}, current.isIdle() ? { triggerTurn: true } : { triggerTurn: true, deliverAs: "followUp" });
		}).catch((error) => {
			if (generation === this.generation) this.context?.ui.notify(`Capability result delivery failed: ${String(error)}. Read ${directory}`, "error");
		});
		return {
			content: [{ type: "text", text: `Started ${id} in background. Result wakes this session. Use capability_jobs to list, read output, or stop. ${kind === "coder" ? "Coder edits this workspace. Do not edit its assigned files until it finishes." : "Keep working on independent tasks; do not assume a verdict before completion."}` }],
			details: { status: "running", id, directory },
		};
	}
}

export function registerBackground(pi: ExtensionAPI): CapabilityBackground {
	const background = new CapabilityBackground(pi);
	pi.on("session_start", (_event, ctx) => background.bind(ctx));
	pi.on("session_before_switch", () => background.cancelAll());
	pi.on("session_before_fork", () => background.cancelAll());
	pi.on("session_before_tree", () => background.cancelAll());
	pi.on("session_shutdown", () => background.cancelAll());
	pi.registerTool({
		name: "capability_jobs", label: "Capability jobs",
		description: "List background coder/reasoning/review runs, read output, or stop a run. Separate from shell jobs. Completion wakes this session.",
		parameters: Type.Object({ action: Type.Union([Type.Literal("list"), Type.Literal("output"), Type.Literal("stop")]), id: Type.Optional(Type.String()) }),
		execute: async (_id, args, _signal, _update, ctx) => {
			const runs = [...background.runs.values()].filter((run) => run.sessionId === ctx.sessionManager.getSessionId());
			if (args.action === "list") return { content: [{ type: "text", text: runs.map((run) => `${run.id} ${run.status} ${run.directory}`).join("\n") || "No capability runs." }], details: {} };
			const run = runs.find((item) => item.id === args.id);
			if (!run) throw new Error("Unknown capability run in this session.");
			if (args.action === "stop") background.stop(run.id);
			const stdout = path.join(run.directory, "report.txt");
			const output = run.text || (existsSync(stdout) ? readFileSync(stdout, "utf8").slice(-16000) : "No final output yet.");
			return { content: [{ type: "text", text: `${run.id} ${run.status}\n${output}\nFiles: ${run.directory}` }], details: { id: run.id, status: run.status } };
		},
	});
	return background;
}
