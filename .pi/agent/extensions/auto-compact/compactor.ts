/**
 * In-flight latch, failure cooldown, and compact trigger for auto-compact.
 */

import type { CompactionResult, ContextUsage, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AutoCompactConfig } from "./config";
import { formatUsageLine } from "./config";

const SUMMARY_HINT =
	"Preserve goals, constraints, decisions, file paths, errors, and next steps. Keep enough detail to continue without re-discovery.";

/** If onComplete/onError never fire, clear inFlight after this. */
export const IN_FLIGHT_TIMEOUT_MS = 180_000;

export type CompactorState = {
	/** True while ctx.compact() is running. */
	inFlight: boolean;
	/** Timestamp when inFlight was set true. */
	inFlightSince: number | null;
	/** Timestamp of last failed compact; used with retryDelayMs. */
	failedAt: number | null;
	/** Last maybeCompact skip/fire reason (for /autocompact status). */
	lastReason: string;
	/** Timer that clears a stuck inFlight latch. */
	inFlightTimer: ReturnType<typeof setTimeout> | null;
};

export function createCompactorState(): CompactorState {
	return {
		inFlight: false,
		inFlightSince: null,
		failedAt: null,
		lastReason: "init",
		inFlightTimer: null,
	};
}

function clearInFlightTimer(state: CompactorState): void {
	if (state.inFlightTimer) {
		clearTimeout(state.inFlightTimer);
		state.inFlightTimer = null;
	}
}

export function resetCompactorState(state: CompactorState): void {
	clearInFlightTimer(state);
	state.inFlight = false;
	state.inFlightSince = null;
	state.failedAt = null;
	state.lastReason = "reset";
}

function markInFlight(state: CompactorState, source: string): void {
	clearInFlightTimer(state);
	state.inFlight = true;
	state.inFlightSince = Date.now();
	const timer = setTimeout(() => {
		if (!state.inFlight) return;
		state.inFlight = false;
		state.inFlightSince = null;
		state.failedAt = Date.now();
		state.lastReason = `${source}: in-flight timeout ${IN_FLIGHT_TIMEOUT_MS}ms`;
		state.inFlightTimer = null;
	}, IN_FLIGHT_TIMEOUT_MS);
	timer.unref?.();
	state.inFlightTimer = timer;
}

function markIdle(state: CompactorState, reason: string, failed: boolean): void {
	clearInFlightTimer(state);
	state.inFlight = false;
	state.inFlightSince = null;
	state.lastReason = reason;
	if (failed) state.failedAt = Date.now();
	else state.failedAt = null;
}

function notify(
	ctx: ExtensionContext,
	config: AutoCompactConfig,
	message: string,
	level: "info" | "warning" | "error" = "info",
): void {
	if (!config.notify || !ctx.hasUI) return;
	ctx.ui.notify(message, level);
}

function readUsage(ctx: ExtensionContext): ContextUsage | undefined {
	try {
		return ctx.getContextUsage();
	} catch {
		return undefined;
	}
}

export type MaybeCompactResult = {
	fired: boolean;
	reason: string;
	usage?: ContextUsage;
};

/**
 * Decide whether to compact and fire ctx.compact() if needed.
 * Prefer agent_settled / idle command paths. Re-reads usage every call.
 */
export function maybeCompact(
	ctx: ExtensionContext,
	config: AutoCompactConfig,
	state: CompactorState,
	source: string,
	options?: { requireIdle?: boolean },
): MaybeCompactResult {
	const requireIdle = options?.requireIdle ?? true;

	if (!config.enabled) {
		state.lastReason = `${source}: disabled`;
		return { fired: false, reason: state.lastReason };
	}
	if (state.inFlight) {
		state.lastReason = `${source}: in-flight`;
		return { fired: false, reason: state.lastReason };
	}
	// ctx.compact() aborts the agent. Default: only when idle.
	if (requireIdle && !ctx.isIdle()) {
		state.lastReason = `${source}: not-idle (will retry on settle)`;
		return { fired: false, reason: state.lastReason };
	}

	const usage = readUsage(ctx);
	if (!usage || usage.percent == null || usage.tokens == null) {
		state.lastReason = `${source}: usage-unknown`;
		return { fired: false, reason: state.lastReason, usage };
	}
	if (usage.contextWindow <= 0) {
		state.lastReason = `${source}: no-window`;
		return { fired: false, reason: state.lastReason, usage };
	}
	if (usage.percent < config.thresholdPercent) {
		state.lastReason = `${source}: below ${config.thresholdPercent}% (${usage.percent.toFixed(1)}%)`;
		return { fired: false, reason: state.lastReason, usage };
	}

	if (state.failedAt != null) {
		const elapsed = Date.now() - state.failedAt;
		if (elapsed < config.retryDelayMs) {
			state.lastReason = `${source}: cooldown ${config.retryDelayMs - elapsed}ms`;
			return { fired: false, reason: state.lastReason, usage };
		}
	}

	const usageLine = formatUsageLine(usage.percent, usage.tokens, usage.contextWindow);
	markInFlight(state, source);
	state.lastReason = `${source}: firing ${usageLine}`;

	notify(ctx, config, `Auto-compact (${source}): ${usageLine} ≥ ${config.thresholdPercent}%`, "info");

	try {
		ctx.compact({
			customInstructions: SUMMARY_HINT,
			onComplete: (result: CompactionResult) => {
				const before = result.tokensBefore.toLocaleString();
				const after =
					result.estimatedTokensAfter == null
						? "?"
						: result.estimatedTokensAfter.toLocaleString();
				markIdle(state, `${source}: done ~${before}→~${after}`, false);
				notify(ctx, config, `Compacted: ~${before} → ~${after} tokens`, "info");
			},
			onError: (error: Error) => {
				markIdle(state, `${source}: error ${error.message}`, true);
				notify(ctx, config, `Auto-compact failed: ${error.message}`, "error");
			},
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		markIdle(state, `${source}: throw ${message}`, true);
		notify(ctx, config, `Auto-compact failed: ${message}`, "error");
		return { fired: false, reason: state.lastReason, usage };
	}

	return { fired: true, reason: state.lastReason, usage };
}

/** Force compact ignoring threshold (still respects inFlight). Aborts agent if running. */
export function forceCompact(
	ctx: ExtensionContext,
	config: AutoCompactConfig,
	state: CompactorState,
): boolean {
	if (state.inFlight) {
		state.lastReason = "force: in-flight";
		notify(ctx, config, "Compaction already in progress", "warning");
		return false;
	}

	markInFlight(state, "force");
	state.lastReason = "force: firing";
	notify(ctx, config, "Compacting now…", "info");

	try {
		ctx.compact({
			customInstructions: SUMMARY_HINT,
			onComplete: (result: CompactionResult) => {
				const before = result.tokensBefore.toLocaleString();
				const after =
					result.estimatedTokensAfter == null
						? "?"
						: result.estimatedTokensAfter.toLocaleString();
				markIdle(state, `force: done ~${before}→~${after}`, false);
				notify(ctx, config, `Compacted: ~${before} → ~${after} tokens`, "info");
			},
			onError: (error: Error) => {
				markIdle(state, `force: error ${error.message}`, true);
				notify(ctx, config, `Compaction failed: ${error.message}`, "error");
			},
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		markIdle(state, `force: throw ${message}`, true);
		notify(ctx, config, `Compaction failed: ${message}`, "error");
		return false;
	}

	return true;
}
