/**
 * Auto-compact when context usage hits a percent of the model window.
 *
 * Built-in auto-compact only fires near the limit:
 *   tokens > contextWindow - reserveTokens  (default reserve 16k)
 * On large windows that is late; this extension fires earlier (default 75%).
 *
 * Why settle-only failed:
 *   isIdle = !_isAgentRunActive for the WHOLE _runAgentPrompt, including every
 *   tool turn and agent.continue() drain. A finished assistant "response" still
 *   leaves the session busy until the entire run ends. Built-in compact runs in
 *   _handlePostAgentRun while still busy; we used to wait for idle and missed.
 *
 * Triggers:
 * - turn_end when over threshold (may abort remaining tools/continues — intentional)
 * - agent_settled (idle backup)
 * - 30s idle watchdog
 * - session_start deferred retries
 * - /autocompact now|on|NN
 *
 * Manual: /autocompact
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	configPath,
	formatUsageLine,
	MAX_THRESHOLD,
	MIN_THRESHOLD,
	readConfig,
	writeConfig,
	type AutoCompactConfig,
} from "./config";
import { createCompactorState, forceCompact, maybeCompact, resetCompactorState } from "./compactor";
import { summarizeWithFixedModel } from "./summarizer";

function assistantHasToolCalls(message: unknown): boolean {
	if (!message || typeof message !== "object") return false;
	const content = (message as { content?: unknown }).content;
	if (!Array.isArray(content)) return false;
	return content.some((block) => block && typeof block === "object" && (block as { type?: string }).type === "toolCall");
}

function assistantStopReason(message: unknown): string | undefined {
	if (!message || typeof message !== "object") return undefined;
	const stop = (message as { stopReason?: unknown }).stopReason;
	return typeof stop === "string" ? stop : undefined;
}

/** Retries after session_start while usage/idle may still be warming up. */
const START_RETRY_MS = [0, 500, 2000, 5000] as const;
/** Poll while session is open so continuous work still compacts once idle. */
const IDLE_WATCHDOG_MS = 30_000;

export default function autoCompactExtension(pi: ExtensionAPI) {
	let config: AutoCompactConfig = readConfig();
	const state = createCompactorState();

	/** Session-only overrides; cleared on session_start. */
	let sessionEnabled: boolean | undefined;
	let sessionThreshold: number | undefined;
	let startTimers: ReturnType<typeof setTimeout>[] = [];
	let watchdog: ReturnType<typeof setInterval> | null = null;
	/** Latest ctx for watchdog ticks (commands/settled refresh it). */
	let latestCtx: ExtensionContext | undefined;
	/** Warn once per session when compactModel cannot be resolved. */
	let compactModelWarned = false;

	function effectiveConfig(): AutoCompactConfig {
		return {
			...config,
			enabled: sessionEnabled ?? config.enabled,
			thresholdPercent: sessionThreshold ?? config.thresholdPercent,
		};
	}

	function clearStartTimers(): void {
		for (const timer of startTimers) clearTimeout(timer);
		startTimers = [];
	}

	function stopWatchdog(): void {
		if (watchdog) {
			clearInterval(watchdog);
			watchdog = null;
		}
	}

	function startWatchdog(): void {
		stopWatchdog();
		watchdog = setInterval(() => {
			if (!latestCtx) return;
			// Only acts when idle + over threshold; no-op while Working...
			maybeCompact(latestCtx, effectiveConfig(), state, "watchdog");
		}, IDLE_WATCHDOG_MS);
		watchdog.unref?.();
	}

	function rememberCtx(ctx: ExtensionContext): void {
		latestCtx = ctx;
	}

	function statusText(ctx: ExtensionContext): string {
		const eff = effectiveConfig();
		const usage = ctx.getContextUsage();
		const usageLine = formatUsageLine(
			usage?.percent,
			usage?.tokens,
			usage?.contextWindow ?? 0,
		);
		const scope =
			sessionEnabled !== undefined || sessionThreshold !== undefined ? "session" : "saved";
		const compactModel = eff.compactModel ? `, compact model ${eff.compactModel} (${eff.compactThinking})` : "";
		const cool =
			state.failedAt != null
				? `, cooldown ${Math.max(0, eff.retryDelayMs - (Date.now() - state.failedAt))}ms`
				: "";
		const flight = state.inFlight ? ", compacting" : "";
		const idle = ctx.isIdle() ? "idle" : "busy";
		return (
			`auto-compact: ${eff.enabled ? "on" : "off"} @ ${eff.thresholdPercent}% ` +
			`(${scope}), usage ${usageLine}, ${idle}${compactModel}${flight}${cool}; last: ${state.lastReason}`
		);
	}

	function notifyStatus(ctx: ExtensionContext, message?: string): void {
		if (!ctx.hasUI) return;
		ctx.ui.notify(message ?? statusText(ctx), "info");
	}

	function scheduleStartChecks(ctx: ExtensionContext): void {
		clearStartTimers();
		rememberCtx(ctx);
		for (const delay of START_RETRY_MS) {
			const timer = setTimeout(() => {
				const result = maybeCompact(ctx, effectiveConfig(), state, `session_start+${delay}ms`);
				// Stop retrying once we fired or are clearly under threshold.
				if (result.fired) {
					clearStartTimers();
					return;
				}
				if (result.usage?.percent != null && result.usage.percent < effectiveConfig().thresholdPercent) {
					clearStartTimers();
				}
			}, delay);
			timer.unref?.();
			startTimers.push(timer);
		}
	}

	// After each assistant turn (response + its tool results). Session is still
	// BUSY here. If over threshold, compact anyway — aborts further tools/continues.
	// Defer off the emit stack so abort/waitForIdle does not race the agent loop
	// while turn_end handlers are still unwinding.
	pi.on("turn_end", (event, ctx) => {
		rememberCtx(ctx);
		const stop = assistantStopReason(event.message);
		// Skip hard failures; overflow path / retry may handle those.
		if (stop === "error" || stop === "aborted") {
			state.lastReason = `turn_end: skip stop=${stop}`;
			return;
		}
		const hasTools = assistantHasToolCalls(event.message);
		const usage = ctx.getContextUsage();
		const percent = usage?.percent;
		// Under threshold: never interrupt.
		if (percent == null || percent < effectiveConfig().thresholdPercent) {
			state.lastReason =
				percent == null
					? "turn_end: usage-unknown"
					: `turn_end: below ${effectiveConfig().thresholdPercent}% (${percent.toFixed(1)}%)`;
			return;
		}
		// Over threshold after a turn: compact even while busy.
		const tag = hasTools ? "turn_end+tools" : "turn_end+stop";
		state.lastReason = `${tag}: scheduled (${percent.toFixed(1)}%)`;
		const timer = setTimeout(() => {
			maybeCompact(ctx, effectiveConfig(), state, tag, { requireIdle: false });
		}, 0);
		timer.unref?.();
	});

	// Same idea after a full agent.prompt leg ends (still busy until settled).
	pi.on("agent_end", (_event, ctx) => {
		rememberCtx(ctx);
		const usage = ctx.getContextUsage();
		if (usage?.percent == null || usage.percent < effectiveConfig().thresholdPercent) {
			return;
		}
		state.lastReason = `agent_end: scheduled (${usage.percent.toFixed(1)}%)`;
		const timer = setTimeout(() => {
			maybeCompact(ctx, effectiveConfig(), state, "agent_end", { requireIdle: false });
		}, 0);
		timer.unref?.();
	});

	// Backup: after agent fully stops (idle).
	pi.on("agent_settled", (_event, ctx) => {
		rememberCtx(ctx);
		const result = maybeCompact(ctx, effectiveConfig(), state, "agent_settled");
		// Usage is null right after another compaction path; re-check shortly.
		if (!result.fired && result.reason.includes("usage-unknown")) {
			const timer = setTimeout(() => {
				maybeCompact(ctx, effectiveConfig(), state, "agent_settled+deferred");
			}, 1500);
			timer.unref?.();
		}
	});

	// Any successful compact clears failure latch.
	pi.on("session_compact", () => {
		resetCompactorState(state);
		state.lastReason = "session_compact";
	});

	// Fixed-model summarization for manual and threshold compactions.
	// Overflow recovery is skipped inside summarizeWithFixedModel. Any
	// non-ok outcome returns undefined so the stock compaction runs.
	pi.on("session_before_compact", async (event, ctx) => {
		// Boundary: any unexpected error in the fixed-model path falls back to
		// stock compaction. Never let this hook reject the compaction flow.
		try {
			const outcome = await summarizeWithFixedModel(event, ctx, effectiveConfig());
			if (outcome.kind === "ok") {
				return { compaction: outcome.result };
			}
			if (!ctx.hasUI) return;
			if (outcome.kind === "model-missing" && !compactModelWarned) {
				compactModelWarned = true;
				ctx.ui.notify(
					`auto-compact: compact model "${config.compactModel}" not found; using session model`,
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
		config = readConfig();
		sessionEnabled = undefined;
		sessionThreshold = undefined;
		compactModelWarned = false;
		resetCompactorState(state);
		rememberCtx(ctx);
		startWatchdog();
		// Misconfiguration check: loud at session start, not at first compact.
		if (config.compactModel) {
			const i = config.compactModel.indexOf("/");
			const model = ctx.modelRegistry.find(config.compactModel.slice(0, i), config.compactModel.slice(i + 1));
			if (!model && ctx.hasUI) {
				compactModelWarned = true;
				ctx.ui.notify(
					`auto-compact: compact model "${config.compactModel}" not found; compactions will use the session model`,
					"warning",
				);
			}
			if (model && model.api !== "openai-codex-responses" && config.compactThinking !== "off" && ctx.hasUI) {
				ctx.ui.notify(
					`auto-compact: compact thinking "${config.compactThinking}" is not sent to ${model.api} models; it is ignored`,
					"warning",
				);
			}
		}
		// Reload while already over threshold: try now and a few deferred times
		// (usage/idle can lag right after reload).
		scheduleStartChecks(ctx);
	});

	pi.on("session_shutdown", () => {
		clearStartTimers();
		stopWatchdog();
		latestCtx = undefined;
	});

	pi.registerCommand("autocompact", {
		description:
			"Toggle auto-compact. Usage: /autocompact [status|on|off|now|save|NN]",
		handler: async (args, ctx) => {
			rememberCtx(ctx);
			const raw = args.trim().toLowerCase();

			// Bare /autocompact toggles session on/off.
			if (!raw) {
				const next = !effectiveConfig().enabled;
				sessionEnabled = next;
				if (next) {
					notifyStatus(
						ctx,
						`auto-compact on @ ${effectiveConfig().thresholdPercent}% (session)`,
					);
					maybeCompact(ctx, effectiveConfig(), state, "command");
				} else {
					notifyStatus(ctx, "auto-compact off (session)");
				}
				return;
			}

			if (raw === "status") {
				notifyStatus(ctx);
				return;
			}

			if (raw === "on") {
				sessionEnabled = true;
				notifyStatus(ctx, `auto-compact on @ ${effectiveConfig().thresholdPercent}% (session)`);
				maybeCompact(ctx, effectiveConfig(), state, "command");
				return;
			}

			if (raw === "off") {
				sessionEnabled = false;
				notifyStatus(ctx, "auto-compact off (session)");
				return;
			}

			if (raw === "now") {
				// Force aborts current agent if needed — user asked explicitly.
				forceCompact(ctx, effectiveConfig(), state);
				return;
			}

			if (raw === "save") {
				const next: AutoCompactConfig = {
					...config,
					enabled: sessionEnabled ?? config.enabled,
					thresholdPercent: sessionThreshold ?? config.thresholdPercent,
				};
				writeConfig(next);
				config = next;
				sessionEnabled = undefined;
				sessionThreshold = undefined;
				notifyStatus(ctx, `Saved to ${configPath()}`);
				return;
			}

			if (raw === "reload") {
				config = readConfig();
				sessionEnabled = undefined;
				sessionThreshold = undefined;
				notifyStatus(ctx, `Reloaded ${configPath()}`);
				return;
			}

			const n = Number(raw);
			if (Number.isFinite(n) && n >= MIN_THRESHOLD && n <= MAX_THRESHOLD) {
				sessionThreshold = Math.round(n);
				sessionEnabled = true;
				notifyStatus(
					ctx,
					`auto-compact on @ ${sessionThreshold}% (session). /autocompact save to persist.`,
				);
				maybeCompact(ctx, effectiveConfig(), state, "command");
				return;
			}

			if (ctx.hasUI) {
				ctx.ui.notify(
					`Usage: /autocompact (toggle) | status|on|off|now|save|reload|${MIN_THRESHOLD}-${MAX_THRESHOLD}`,
					"warning",
				);
			}
		},
	});
}

export { DEFAULT_CONFIG, DEFAULT_THRESHOLD, configPath } from "./config";
