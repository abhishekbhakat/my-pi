/**
 * Shared mutable session state for the auto-compact extension.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	formatUsageLine,
	readConfig,
	type AutoCompactConfig,
} from "./config";
import {
	createCompactorState,
	maybeCompact,
	resetCompactorState,
	type CompactorState,
} from "./compactor";
import {
	createResumeState,
	maybeFireResume,
	resetResumeState,
	type ResumeState,
} from "./resumer";

/** Retries after session_start while usage/idle may still be warming up. */
export const START_RETRY_MS = [0, 500, 2000, 5000] as const;
/** Poll while session is open so continuous work still compacts once idle. */
export const IDLE_WATCHDOG_MS = 30_000;

export type SessionRuntime = {
	pi: ExtensionAPI;
	config: AutoCompactConfig;
	state: CompactorState;
	resumeState: ResumeState;
	/** Session-only overrides; cleared on session_start. */
	sessionEnabled: boolean | undefined;
	sessionThreshold: number | undefined;
	startTimers: ReturnType<typeof setTimeout>[];
	watchdog: ReturnType<typeof setInterval> | null;
	/** Latest ctx for watchdog ticks (commands/settled refresh it). */
	latestCtx: ExtensionContext | undefined;
	/** Warn once per session when compactModel cannot be resolved. */
	compactModelWarned: boolean;
};

export function createRuntime(pi: ExtensionAPI): SessionRuntime {
	return {
		pi,
		config: readConfig(),
		state: createCompactorState(),
		resumeState: createResumeState(),
		sessionEnabled: undefined,
		sessionThreshold: undefined,
		startTimers: [],
		watchdog: null,
		latestCtx: undefined,
		compactModelWarned: false,
	};
}

export function effectiveConfig(rt: SessionRuntime): AutoCompactConfig {
	return {
		...rt.config,
		enabled: rt.sessionEnabled ?? rt.config.enabled,
		thresholdPercent: rt.sessionThreshold ?? rt.config.thresholdPercent,
	};
}

export function rememberCtx(rt: SessionRuntime, ctx: ExtensionContext): void {
	rt.latestCtx = ctx;
}

export function clearStartTimers(rt: SessionRuntime): void {
	for (const timer of rt.startTimers) clearTimeout(timer);
	rt.startTimers = [];
}

export function stopWatchdog(rt: SessionRuntime): void {
	if (rt.watchdog) {
		clearInterval(rt.watchdog);
		rt.watchdog = null;
	}
}

export function startWatchdog(rt: SessionRuntime): void {
	stopWatchdog(rt);
	rt.watchdog = setInterval(() => {
		if (!rt.latestCtx) return;
		maybeCompact(rt.latestCtx, effectiveConfig(rt), rt.state, "watchdog");
	}, IDLE_WATCHDOG_MS);
	rt.watchdog.unref?.();
}

export function statusText(rt: SessionRuntime, ctx: ExtensionContext): string {
	const eff = effectiveConfig(rt);
	const usage = ctx.getContextUsage();
	const usageLine = formatUsageLine(usage?.percent, usage?.tokens, usage?.contextWindow ?? 0);
	const scope =
		rt.sessionEnabled !== undefined || rt.sessionThreshold !== undefined ? "session" : "saved";
	const compactModel = eff.compactModel
		? `, compact model ${eff.compactModel} (${eff.compactThinking})`
		: "";
	const cool =
		rt.state.failedAt != null
			? `, cooldown ${Math.max(0, eff.retryDelayMs - (Date.now() - rt.state.failedAt))}ms`
			: "";
	const flight = rt.state.inFlight ? ", compacting" : "";
	const resume = eff.autoResume
		? `, resume ${rt.resumeState.resumes}/${eff.maxResumes}` +
			(rt.resumeState.pending ? " pending" : "") +
			(rt.resumeState.lastOutcome !== "none" ? ` (${rt.resumeState.lastOutcome})` : "")
		: "";
	const idle = ctx.isIdle() ? "idle" : "busy";
	return (
		`auto-compact: ${eff.enabled ? "on" : "off"} @ ${eff.thresholdPercent}% ` +
		`(${scope}), usage ${usageLine}, ${idle}${compactModel}${flight}${cool}${resume}; last: ${rt.state.lastReason}`
	);
}

export function notifyStatus(rt: SessionRuntime, ctx: ExtensionContext, message?: string): void {
	if (!ctx.hasUI) return;
	ctx.ui.notify(message ?? statusText(rt, ctx), "info");
}

export function tryResume(rt: SessionRuntime, ctx: ExtensionContext): void {
	maybeFireResume(
		ctx,
		effectiveConfig(rt),
		rt.resumeState,
		(text) => {
			rt.pi.sendUserMessage(text, { expandPromptTemplates: false });
		},
		(message, kind) => {
			if (!ctx.hasUI) return;
			if (kind === "info" && !effectiveConfig(rt).notify) return;
			ctx.ui.notify(message, kind);
		},
	);
}

export function scheduleStartChecks(rt: SessionRuntime, ctx: ExtensionContext): void {
	clearStartTimers(rt);
	rememberCtx(rt, ctx);
	for (const delay of START_RETRY_MS) {
		const timer = setTimeout(() => {
			const result = maybeCompact(ctx, effectiveConfig(rt), rt.state, `session_start+${delay}ms`);
			if (result.fired) {
				clearStartTimers(rt);
				return;
			}
			if (
				result.usage?.percent != null &&
				result.usage.percent < effectiveConfig(rt).thresholdPercent
			) {
				clearStartTimers(rt);
			}
		}, delay);
		timer.unref?.();
		rt.startTimers.push(timer);
	}
}

export function onSessionStart(rt: SessionRuntime, ctx: ExtensionContext): void {
	rt.config = readConfig();
	rt.sessionEnabled = undefined;
	rt.sessionThreshold = undefined;
	rt.compactModelWarned = false;
	resetCompactorState(rt.state);
	resetResumeState(rt.resumeState);
	rememberCtx(rt, ctx);
	startWatchdog(rt);

	if (rt.config.compactModel) {
		const i = rt.config.compactModel.indexOf("/");
		const model = ctx.modelRegistry.find(
			rt.config.compactModel.slice(0, i),
			rt.config.compactModel.slice(i + 1),
		);
		if (!model && ctx.hasUI) {
			rt.compactModelWarned = true;
			ctx.ui.notify(
				`auto-compact: compact model "${rt.config.compactModel}" not found; compactions will use the session model`,
				"warning",
			);
		}
		if (
			model &&
			model.api !== "openai-codex-responses" &&
			rt.config.compactThinking !== "off" &&
			ctx.hasUI
		) {
			ctx.ui.notify(
				`auto-compact: compact thinking "${rt.config.compactThinking}" is not sent to ${model.api} models; it is ignored`,
				"warning",
			);
		}
	}
	scheduleStartChecks(rt, ctx);
}

export function onSessionShutdown(rt: SessionRuntime): void {
	clearStartTimers(rt);
	stopWatchdog(rt);
	rt.latestCtx = undefined;
}
