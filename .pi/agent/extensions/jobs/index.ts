import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Box, Container, MouseRegion, Text } from "@earendil-works/pi-tui";
import { Type } from "@sinclair/typebox";
import {
	OUTPUT_DEFAULT_LINES,
	OUTPUT_MAX_LINES,
	listAction,
	outputAction,
	spawnAction,
	stopAction,
} from "./actions.ts";
import { buildSettledContent, buildSettledSummary, formatElapsed, jobLine, jobName, renderJobs } from "./format.ts";
import { checkBashCommand } from "./guard.ts";
import {
	ensureRoot,
	jobPaths,
	jobsRoot,
	listJobs,
	logSize,
	markNotified,
	pruneJobs,
	pruneSessionRoots,
	reconcile,
	tailLog,
	type JobState,
} from "./state.ts";

const CUSTOM_TYPE = "pi_job_exit";
const TOOL_NAME = "jobs";
const POLL_MS = 2000;
const DEBOUNCE_MS = 300;
const DEBOUNCE_MAX_MS = 2000;
const STALL_MS = 10 * 60_000;
const STALL_TAIL_LINES = 20;

type JobTone = "success" | "error" | "pending";

function toneForJobs(jobs: readonly JobState[]): JobTone {
	return jobs.some((job) => job.status === "stopped" || job.status === "lost" || (job.exitCode ?? 0) !== 0)
		? "error"
		: "success";
}

/** Collapsed job notice. Full tail lives in details.fullContent (not sent to the model). */
class JobMessageComponent extends Container {
	private expanded: boolean;

	constructor(
		private readonly summary: string,
		private readonly full: string,
		private readonly outputPad: number,
		private readonly theme: any,
		expanded: boolean,
		private readonly tone: JobTone,
	) {
		super();
		this.expanded = expanded;
		this.rebuild();
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.rebuild();
	}

	private rebuild(): void {
		this.clear();
		const head = this.theme.fg("accent", "[job] ");
		const hint = this.expanded ? this.theme.fg("dim", "\n(click to collapse)") : this.theme.fg("dim", "\n(click or ctrl+o to expand)");
		const body = this.expanded ? this.full : this.summary;
		const bgName = this.tone === "error" ? "toolErrorBg" : this.tone === "pending" ? "toolPendingBg" : "toolSuccessBg";
		const bg = (value: string) => this.theme.bg(bgName, value);
		const content = new Text(head + body + hint, 1, 1, bg);
		const box = new Box(this.outputPad, 1, bg);
		box.addChild(content);
		this.addChild(
			new MouseRegion(box, (event) => {
				if (event.type !== "click" || event.button !== "left") return;
				this.setExpanded(!this.expanded);
				return { handled: true };
			}),
		);
	}
}

export default function jobsExtension(pi: ExtensionAPI) {
	let activated = false;
	let root: string | undefined;
	let ctxRef: ExtensionContext | undefined;
	let disposed = false;
	let poller: ReturnType<typeof setInterval> | undefined;
	let flushTimer: ReturnType<typeof setTimeout> | undefined;
	let pendingSince = 0;
	let scanning = false;
	const pending = new Set<string>();
	const inFlight = new Set<string>();
	/** Job id -> last observed log size and the time it last grew. */
	const growth = new Map<string, { size: number; since: number }>();
	const stallNotified = new Set<string>();

	async function ensureReady(ctx: ExtensionContext): Promise<string> {
		ctxRef = ctx;
		if (!root) {
			root = jobsRoot(ctx.sessionManager.getSessionId());
			await ensureRoot(root);
		}
		return root;
	}

	function listsTool(value: unknown): boolean {
		if (!Array.isArray(value)) return false;
		return value.some((tool) => (tool as { name?: unknown } | null)?.name === TOOL_NAME);
	}

	/** True when this session's transcript ever declared the tool, meaning its state is deliberate. */
	function transcriptListedTool(ctx: ExtensionContext): boolean {
		try {
			const entries = ctx.sessionManager.getEntries() as unknown as Array<Record<string, unknown>>;
			for (const entry of entries) {
				if (listsTool(entry?.toolsAdded)) return true;
				const message = entry?.message as Record<string, unknown> | undefined;
				if (message && listsTool(message.toolsAdded)) return true;
			}
		} catch {
			return false;
		}
		return false;
	}

	/**
	 * A resumed session restores the tool list recorded in its transcript, which cannot contain
	 * a tool added later. Activate once, but never fight a transcript that already knew the tool
	 * or a harness allowlist that removed it.
	 */
	function ensureToolActive(ctx: ExtensionContext): void {
		if (activated) return;
		try {
			if (!pi.getAllTools().some((tool) => tool.name === TOOL_NAME)) return;
			const active = pi.getActiveTools();
			if (!active.includes(TOOL_NAME) && !transcriptListedTool(ctx)) {
				pi.setActiveTools([...active, TOOL_NAME]);
			}
			activated = true;
		} catch {
			// Retried from before_agent_start.
		}
	}

	function updateStatus(jobs: readonly JobState[]): void {
		const ctx = ctxRef;
		if (!ctx?.hasUI) return;
		const running = jobs.filter((job) => job.status === "running");
		if (running.length === 0) {
			ctx.ui.setStatus("jobs", undefined);
			return;
		}
		const stalled = running.filter((job) => {
			const seen = growth.get(job.id);
			return seen ? Date.now() - seen.since >= STALL_MS : false;
		});
		const parts = [`${running.length} running`];
		if (stalled.length > 0) parts.push(`${stalled.length} quiet ${formatElapsed(STALL_MS)}`);
		ctx.ui.setStatus("jobs", parts.join(", "));
	}

	function queueSettled(id: string): void {
		if (inFlight.has(id) || pending.has(id)) return;
		pending.add(id);
		const now = Date.now();
		if (pendingSince === 0) pendingSince = now;
		if (flushTimer) clearTimeout(flushTimer);
		const capped = Math.max(0, pendingSince + DEBOUNCE_MAX_MS - now);
		flushTimer = setTimeout(() => {
			void flushSettled();
		}, Math.min(DEBOUNCE_MS, capped));
	}

	async function flushSettled(): Promise<void> {
		flushTimer = undefined;
		pendingSince = 0;
		const ids = [...pending];
		pending.clear();
		const rootPath = root;
		if (disposed || !rootPath || ids.length === 0) return;
		for (const id of ids) inFlight.add(id);
		try {
			const all = await listJobs(rootPath);
			const jobs = all.filter((job) => ids.includes(job.id) && job.status !== "running");
			if (jobs.length === 0) return;
			const running = all.filter((job) => job.status === "running");
			const tails = new Map<string, string>();
			for (const job of jobs) {
				tails.set(job.id, await tailLog(jobPaths(rootPath, job.id).log, STALL_TAIL_LINES));
			}
			const fullContent = buildSettledContent(jobs, tails, running);
			const content = buildSettledSummary(jobs, running);
			const idle = ctxRef?.isIdle() ?? true;
			await pi.sendMessage(
				{ customType: CUSTOM_TYPE, content, display: true, details: { ids: jobs.map((job) => job.id), fullContent, tone: toneForJobs(jobs) } },
				idle ? { triggerTurn: true } : { triggerTurn: true, deliverAs: "followUp" },
			);
			for (const job of jobs) await markNotified(rootPath, job.id);
		} catch {
			// Leave notified=false. The next poll queues these again.
		} finally {
			for (const id of ids) inFlight.delete(id);
		}
	}

	async function watchStalls(jobs: readonly JobState[]): Promise<void> {
		const rootPath = root;
		if (!rootPath) return;
		const now = Date.now();
		for (const job of jobs) {
			if (job.status !== "running") {
				growth.delete(job.id);
				continue;
			}
			const size = await logSize(jobPaths(rootPath, job.id).log);
			const seen = growth.get(job.id);
			if (!seen || size > seen.size) {
				growth.set(job.id, { size, since: now });
				continue;
			}
			if (now - seen.since < STALL_MS) continue;
			const key = `${job.id}:${size}`;
			if (stallNotified.has(key)) continue;
			stallNotified.add(key);
			const tail = await tailLog(jobPaths(rootPath, job.id).log, STALL_TAIL_LINES);
			const quiet = formatElapsed(now - seen.since);
			const body = tail.length > 0 ? "```\n" + tail + "\n```" : "(log is empty)";
			const content =
				`Job ${job.id} (${jobName(job)}) produced no output for ${quiet} and is still running.\n\n${body}\n\n` +
				`Nothing was killed. Use jobs output ${job.id} or jobs stop ${job.id}.`;
			ctxRef?.ui.notify(`Job ${job.id} quiet for ${quiet}`, "warning");
			try {
				await pi.sendMessage(
					{ customType: CUSTOM_TYPE, content, display: true, details: { ids: [job.id], stall: true, tone: "pending" } },
					{ deliverAs: "nextTurn" },
				);
			} catch {
				// Report again on the next unchanged size.
				stallNotified.delete(key);
			}
		}
	}

	async function scan(notify: boolean): Promise<void> {
		if (!root || scanning || disposed) return;
		scanning = true;
		try {
			const { all } = await reconcile(root);
			if (notify) {
				for (const job of all) {
					if (job.status === "running" || job.notified) continue;
					queueSettled(job.id);
				}
			}
			await watchStalls(all);
			updateStatus(all);
		} catch {
			// Keep the poller alive across a transient fs error.
		} finally {
			scanning = false;
		}
	}

	function startPoller(): void {
		if (poller) clearInterval(poller);
		poller = setInterval(() => {
			void scan(true);
		}, POLL_MS);
		poller.unref?.();
	}

	pi.registerMessageRenderer(CUSTOM_TYPE, (message, options, theme) => {
		const details = message.details as { fullContent?: string; tone?: JobTone } | undefined;
		const summary = String(message.content);
		return new JobMessageComponent(summary, details?.fullContent ?? summary, options.outputPad, theme, options.expanded, details?.tone ?? "success");
	});

	pi.on("tool_call", (event) => {
		if (event.toolName !== "bash") return;
		const input = event.input as { command?: string; timeout?: number };
		// A model-chosen timeout is a duration guess. Drop it, keep the command.
		if (input.timeout !== undefined) delete input.timeout;
		if (typeof input.command !== "string") return;
		const reason = checkBashCommand(input.command);
		if (reason) return { block: true, reason };
	});

	pi.on("session_start", async (event, ctx) => {
		activated = false;
		ensureToolActive(ctx);
		disposed = false;
		root = jobsRoot(ctx.sessionManager.getSessionId());
		ctxRef = ctx;
		await ensureRoot(root);
		await pruneJobs(root);
		void pruneSessionRoots().catch(() => undefined);
		const { all } = await reconcile(root);
		const unsettled = all.filter((job) => job.status !== "running" && !job.notified);
		if (unsettled.length > 0) {
			if (event.reason === "reload") {
				// Same live session, so a job finishing during reload is still a real wake.
				for (const job of unsettled) queueSettled(job.id);
			} else {
				const content = `Finished while pi was closed:\n${renderJobs(unsettled)}`;
				try {
					await pi.sendMessage(
						{ customType: CUSTOM_TYPE, content, display: true, details: { ids: unsettled.map((job) => job.id), tone: toneForJobs(unsettled) } },
						{ deliverAs: "nextTurn" },
					);
					for (const job of unsettled) await markNotified(root, job.id);
				} catch {
					// Keep notified=false so the next session retries.
				}
			}
		}
		updateStatus(all);
		startPoller();
		void scan(true);
	});

	pi.on("before_agent_start", (_event, ctx) => {
		ensureToolActive(ctx);
	});

	pi.on("session_shutdown", async () => {
		disposed = true;
		if (poller) clearInterval(poller);
		if (flushTimer) clearTimeout(flushTimer);
		poller = undefined;
		flushTimer = undefined;
	});

	pi.registerTool({
		name: TOOL_NAME,
		label: "Jobs",
		description:
			"Background jobs that wake you when they finish. spawn starts a command detached and returns an id " +
			"immediately; its exit sends you the exit code and log tail, so no sleep and no timeout is ever needed. " +
			"list shows every job with status, exit code, and elapsed time. output tails one job's log. stop kills " +
			"one job's process group. There is no wait and no timeout parameter by design: durations are never guessed.",
		promptSnippet: "Run slow commands in background; exit wakes you. No sleep, no timeout.",
		promptGuidelines: [
			"Never use `sleep N`, `sleep N && check`, a trailing `&`, nohup, or bash `timeout`. Each guesses a duration, and every model guesses wrong.",
			'Anything that takes time (build, test, install, server, watch) goes through `jobs spawn "<command>"`. It wakes you when the process exits, with the exit code and log tail.',
			"For a server: spawn it, then spawn a readiness loop such as `until curl -sf http://localhost:3000; do sleep 0.2; done`. Sleep inside a spawned loop is fine because the loop ends on a condition.",
			"Foreground bash only for commands that finish at once. There is no `timeout` parameter to pass; it is stripped.",
			"Check with `jobs list` or `jobs output <id>` only when you need the answer now. Do not poll a running job with sleep.",
		],
		parameters: Type.Object({
			action: StringEnum(["spawn", "list", "output", "stop"] as const, {
				description: "spawn starts a background job; list shows all; output tails one; stop kills one",
			}),
			command: Type.Optional(Type.String({ description: "Shell command to run in the background (spawn only)" })),
			label: Type.Optional(Type.String({ description: "Short human name for the job (spawn only)" })),
			id: Type.Optional(Type.String({ description: "Job id such as j1 (output and stop)" })),
			lines: Type.Optional(
				Type.Integer({
					minimum: 1,
					maximum: OUTPUT_MAX_LINES,
					description: `Log tail lines for output (default ${OUTPUT_DEFAULT_LINES}, max ${OUTPUT_MAX_LINES})`,
				}),
			),
		}),

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const rootPath = await ensureReady(ctx);
			const deps = { updateStatus, scan: () => void scan(true) };
			if (params.action === "spawn") return await spawnAction(rootPath, ctx, params, signal, deps);
			if (params.action === "list") return await listAction(rootPath, deps);
			if (params.action === "output") return await outputAction(rootPath, params);
			return await stopAction(rootPath, params, deps);
		},
	});
}
