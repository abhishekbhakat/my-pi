/**
 * Event hooks for auto-compact: threshold triggers, fixed-model summary, resume.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { maybeCompact, resetCompactorState } from "./compactor";
import { clearResumeArm, markAfterCompact } from "./resumer";
import {
	effectiveConfig,
	onSessionShutdown,
	onSessionStart,
	rememberCtx,
	tryResume,
	type SessionRuntime,
} from "./runtime";
import { summarizeWithFixedModel } from "./summarizer";

function assistantStopReason(message: unknown): string | undefined {
	if (!message || typeof message !== "object") return undefined;
	const stop = (message as { stopReason?: unknown }).stopReason;
	return typeof stop === "string" ? stop : undefined;
}

export function registerHooks(pi: ExtensionAPI, rt: SessionRuntime): void {
	// After each assistant turn. Still BUSY here: never compact now — that
	// would abort an in-flight command (scope: let commands finish). Set the
	// reason; agent_settled/watchdog compact once the run ends.
	pi.on("turn_end", (event, ctx) => {
		rememberCtx(rt, ctx);
		const stop = assistantStopReason(event.message);
		if (stop === "error" || stop === "aborted") {
			rt.state.lastReason = `turn_end: skip stop=${stop}`;
			return;
		}
		const usage = ctx.getContextUsage();
		const percent = usage?.percent;
		const eff = effectiveConfig(rt);
		if (percent == null || percent < eff.thresholdPercent) {
			rt.state.lastReason =
				percent == null
					? "turn_end: usage-unknown"
					: `turn_end: below ${eff.thresholdPercent}% (${percent.toFixed(1)}%)`;
			return;
		}
		rt.state.lastReason = `turn_end: over ${eff.thresholdPercent}% (${percent.toFixed(1)}%); deferred to settle`;
	});

	// After a full agent.prompt leg (still busy until settled). Same defer rule.
	pi.on("agent_end", (_event, ctx) => {
		rememberCtx(rt, ctx);
		const usage = ctx.getContextUsage();
		const eff = effectiveConfig(rt);
		if (usage?.percent == null || usage.percent < eff.thresholdPercent) return;
		rt.state.lastReason = `agent_end: over ${eff.thresholdPercent}% (${usage.percent.toFixed(1)}%); deferred to settle`;
	});

	// Idle backup compact + resume path for native threshold (settle after compact).
	pi.on("agent_settled", (_event, ctx) => {
		rememberCtx(rt, ctx);
		const result = maybeCompact(ctx, effectiveConfig(rt), rt.state, "agent_settled");
		if (!result.fired && result.reason.includes("usage-unknown")) {
			const timer = setTimeout(() => {
				maybeCompact(ctx, effectiveConfig(rt), rt.state, "agent_settled+deferred");
			}, 1500);
			timer.unref?.();
		}
		tryResume(rt, ctx);
	});

	// Compact success: clear failure latch, arm resume for native threshold
	// compact (fires while busy; settle consumes). Manual compacts never arm.
	pi.on("session_compact", (event, ctx) => {
		resetCompactorState(rt.state);
		rt.state.lastReason = "session_compact";
		markAfterCompact(event, ctx, rt.resumeState);
		tryResume(rt, ctx);
	});

	pi.on("session_compact_failed", () => {
		clearResumeArm(rt.resumeState);
	});

	// Fixed-model summary. Overflow skipped inside summarizer. Failures → stock.
	pi.on("session_before_compact", async (event, ctx) => {
		try {
			const outcome = await summarizeWithFixedModel(event, ctx, effectiveConfig(rt));
			if (outcome.kind === "ok") return { compaction: outcome.result };
			if (!ctx.hasUI) return;
			if (outcome.kind === "model-missing" && !rt.compactModelWarned) {
				rt.compactModelWarned = true;
				ctx.ui.notify(
					`auto-compact: compact model "${rt.config.compactModel}" not found; using session model`,
					"warning",
				);
				return;
			}
			if (outcome.kind === "fallback") {
				ctx.ui.notify(
					`auto-compact: fixed-model compaction failed (${outcome.message}); falling back to session model`,
					"warning",
				);
			}
		} catch (error) {
			if (!ctx.hasUI) return;
			const message = error instanceof Error ? error.message : String(error);
			ctx.ui.notify(
				`auto-compact: fixed-model compaction error (${message}); falling back to session model`,
				"warning",
			);
		}
		return undefined;
	});

	pi.on("session_start", (_event, ctx) => {
		onSessionStart(rt, ctx);
	});

	pi.on("session_shutdown", () => {
		onSessionShutdown(rt);
	});
}
