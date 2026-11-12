import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { renderCapabilityJobsCall, renderCapabilityResult, registerCapabilityMessages } from "#capability-message";
import { CoderProgress, type CoderChannel, type CoderSend } from "#capability-coder-progress";

type Result = { content: Array<{ type: string; text?: string }>; details?: unknown };
export type BackgroundWork = (signal: AbortSignal, directory: string, channel?: CoderChannel) => Promise<Result>;
export interface CapabilityRun {
	id: string;
	kind: string;
	model?: string;
	effort?: string;
	sessionId: string;
	status: "running" | "cancelling" | "done" | "error" | "cancelled";
	controller: AbortController;
	directory: string;
	text: string;
	completion?: Promise<void>;
	progress?: CoderProgress;
	send?: CoderSend;
}

export class CapabilityBackground {
	readonly runs = new Map<string, CapabilityRun>();
	private generation = 0;
	private context?: ExtensionContext;
	private paintTimer?: ReturnType<typeof setTimeout>;
	private widgetShown = false;

	constructor(private readonly pi: ExtensionAPI) {}

	bind(ctx: ExtensionContext): void { this.context = ctx; }

	async cancelAll(): Promise<void> {
		this.generation++;
		if (this.paintTimer) clearTimeout(this.paintTimer);
		this.paintTimer = undefined;
		for (const run of this.runs.values()) this.stop(run.id);
		this.context?.ui.setWidget("capability-live", undefined);
		this.widgetShown = false;
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
		const ctx = this.context;
		if (!ctx) return;
		const active = [...this.runs.values()].filter((run) => run.sessionId === ctx.sessionManager.getSessionId() && (run.status === "running" || run.status === "cancelling"));
		ctx.ui.setStatus("capability-background", active.length ? `Capabilities: ${active.length} running` : undefined);
		const panes: Pane[] = active.filter((run) => run.kind === "coder" || run.progress).map((run) => {
			return {
				title: [
					`${run.kind} ${run.id.slice(run.kind.length + 1, run.kind.length + 9)}`,
					run.model, run.effort, run.status === "cancelling" ? "cancelling" : undefined,
				].filter(Boolean).join(" | "),
				body: run.progress?.lines(BODY_ROWS) ?? [],
				footer: run.kind === "coder" ? "PARTIAL | /coder-send <instruction> | /coder-stop" : "PARTIAL | stop via capability_jobs",
			};
		});
		if (!panes.length) {
			ctx.ui.setWidget("capability-live", undefined);
			this.widgetShown = false;
			return;
		}
		ctx.ui.setWidget("capability-live", (_tui, theme) => ({
			render: (width: number) => renderPanes(panes, width, (text) => theme.fg("dim", text)),
			invalidate() {},
		}));
		if (!this.widgetShown) {
			this.widgetShown = true;
			// Tool counter listens and re-adds itself so it renders below this panel.
			this.pi.events.emit("capability:panel-open", {});
		}
	}

	private schedulePaint(): void {
		if (this.paintTimer) return;
		const generation = this.generation;
		this.paintTimer = setTimeout(() => {
			this.paintTimer = undefined;
			if (generation === this.generation) this.paint();
		}, 250);
	}

	async steer(id: string, message: string): Promise<string> {
		const run = this.runs.get(id);
		if (!message.trim()) throw new Error("Instruction must not be empty.");
		if (!run || run.kind !== "coder") throw new Error("Only coder runs accept instructions.");
		if (run.status !== "running" || !run.send) throw new Error("Coder is starting, stopping, or finished. Inspect capability_jobs output.");
		return run.send(message);
	}

	start(kind: string, ctx: ExtensionContext, work: BackgroundWork, metadata: Pick<CapabilityRun, "model" | "effort"> = {}): AgentToolResult {
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
			id, kind, directory, model: metadata.model, effort: metadata.effort, sessionId: ctx.sessionManager.getSessionId(),
			status: "running", controller: new AbortController(), text: "",
		};
		this.runs.set(id, run);
		// Keep the in-memory index bounded; completed output remains on disk.
		for (const [oldId, old] of this.runs) {
			if (this.runs.size <= 50) break;
			if (old.status !== "running" && old.status !== "cancelling") this.runs.delete(oldId);
		}
		const generation = this.generation;
		if (["coder", "code_scout", "reasoning_coach", "patch_reviewer"].includes(kind)) run.progress = new CoderProgress(directory);
		const channel: CoderChannel | undefined = run.progress ? {
			update: (update) => {
				if (generation !== this.generation || run.status !== "running") return;
				run.progress!.update(update);
				this.schedulePaint();
			},
			attach: (send) => { run.send = kind === "coder" && run.status === "running" ? send : undefined; },
		} : undefined;
		this.paint();
		run.completion = Promise.resolve().then(() => {
			if (run.controller.signal.aborted) throw new Error("Capability cancelled before launch.");
			return work(run.controller.signal, directory, channel);
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
			run.send = undefined;
			const recoveryFile = path.join(directory, "recovery.json");
			if (kind === "coder" && existsSync(recoveryFile)) {
				const recovery = JSON.parse(readFileSync(recoveryFile, "utf8"));
				const summary = `Recovery: class=${recovery.errorClass}, repairs=${recovery.repairCount}, retries=${recovery.retryCount}, tools=${recovery.toolsExecuted}`;
				run.text = `${run.text}\n\n${summary}`;
				run.progress?.update({ phase: run.status, text: summary });
			}
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
			content: [{ type: "text", text: `Started ${id} in background. Result wakes this session; the UI already shows this launch, so do not restate it to the user. ${kind === "coder" ? "Coder edits this workspace. Do not edit its assigned files until it finishes." : "Continue independent work or end the turn without commentary; do not assume a verdict before completion."}` }],
			details: { status: "running", id, directory },
		};
	}
}

const BODY_ROWS = 4;

interface Pane { title: string; body: string[]; footer: string }

/** One frame, one column per pane. Fixed height: BODY_ROWS plus a title border row and a footer border row. */
export function renderPanes(panes: Pane[], width: number, dim: (text: string) => string): string[] {
	const count = panes.length;
	const inner = Math.max(count * 6, width - count - 1);
	const base = Math.floor(inner / count);
	const widths = panes.map((_, index) => base + (index < inner - base * count ? 1 : 0));
	const edge = (label: string, w: number) => {
		const text = truncateToWidth(` ${label} `, Math.max(0, w - 2), "…");
		return dim("─") + text + dim("─".repeat(Math.max(0, w - 1 - visibleWidth(text))));
	};
	const fit = (line: string) => (visibleWidth(line) > width ? truncateToWidth(line, width, "") : line);
	const out = [fit(dim("┌") + panes.map((pane, index) => edge(pane.title, widths[index])).join(dim("┬")) + dim("┐"))];
	for (let row = 0; row < BODY_ROWS; row++) {
		const cells = panes.map((pane, index) => truncateToWidth(pane.body[row] ?? "", widths[index], "…", true));
		out.push(fit(dim("│") + cells.join(dim("│")) + dim("│")));
	}
	out.push(fit(dim("└") + panes.map((pane, index) => edge(pane.footer, widths[index])).join(dim("┴")) + dim("┘")));
	return out;
}

export function registerBackground(pi: ExtensionAPI): CapabilityBackground {
	registerCapabilityMessages(pi);
	const background = new CapabilityBackground(pi);
	pi.on("session_start", (_event, ctx) => background.bind(ctx));
	pi.on("session_before_switch", () => background.cancelAll());
	pi.on("session_before_fork", () => background.cancelAll());
	pi.on("session_before_tree", () => background.cancelAll());
	pi.on("session_shutdown", () => background.cancelAll());
	pi.registerTool({
		name: "capability_jobs", label: "Capability jobs",
		description: "List background runs, read output, stop, or steer coder with a message. Coder, scout, reasoning, and review output streams as PARTIAL, never a final verdict. Only coder accepts steering. Separate from shell jobs. The live panel already shows helper progress, so no need to poll output while a run is still going.",
		renderCall: renderCapabilityJobsCall,
		renderResult: renderCapabilityResult("Capability jobs"),
		parameters: Type.Object({ action: Type.Union([Type.Literal("list"), Type.Literal("output"), Type.Literal("stop"), Type.Literal("steer")]), id: Type.Optional(Type.String()), message: Type.Optional(Type.String()) }),
		execute: async (_id, args, _signal, _update, ctx) => {
			const runs = [...background.runs.values()].filter((run) => run.sessionId === ctx.sessionManager.getSessionId());
			if (args.action === "list") return { content: [{ type: "text", text: runs.map((run) => `${run.id} ${run.status} ${run.directory}`).join("\n") || "No capability runs." }], details: {} };
			const run = runs.find((item) => item.id === args.id);
			if (!run) throw new Error("Unknown capability run in this session.");
			if (args.action === "steer") return { content: [{ type: "text", text: await background.steer(run.id, args.message ?? "") }], details: { id: run.id } };
			if (args.action === "stop") background.stop(run.id);
			const stdout = path.join(run.directory, "report.txt");
			const partial = run.status === "running" || run.status === "cancelling";
			const output = partial && run.progress ? run.progress.partial() : run.text || (existsSync(stdout) ? readFileSync(stdout, "utf8").slice(-16000) : "No final output yet.");
			return { content: [{ type: "text", text: `${run.id} ${run.status}\n${output}\nFiles: ${run.directory}` }], details: { id: run.id, status: run.status } };
		},
	});
	for (const command of ["coder-send", "coder-stop"]) {
		pi.registerCommand(command, {
			description: command === "coder-send" ? "Send instructions to active coder after its current tool turn" : "Stop active coder; keep edits already written",
			handler: async (args, ctx) => {
				const run = [...background.runs.values()].find((item) => item.kind === "coder" && item.sessionId === ctx.sessionManager.getSessionId() && item.status === "running");
				if (!run) { ctx.ui.notify("No running coder in this session.", "warning"); return; }
				try {
					if (command === "coder-stop") { background.stop(run.id); ctx.ui.notify("Coder stopping. Existing edits stay on disk.", "info"); }
					else ctx.ui.notify(await background.steer(run.id, args.trim()), "info");
				} catch (error) { ctx.ui.notify(String(error), "error"); }
			},
		});
	}
	return background;
}
