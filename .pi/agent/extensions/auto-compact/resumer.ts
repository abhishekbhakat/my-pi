/**
 * Auto-resume after the native threshold auto-compact interrupts mid-task
 * tool work.
 *
 * Native threshold compact fires session_compact inside the still-active run,
 * then agent_settled once the loop exits (verified in pi-coding-agent dist).
 * This extension's own compacts are idle-only (commands finish first), so a
 * resumed "toolUse" tail only exists on the native path. Manual /compact and
 * overflow are never resumed: overflow retries via the SDK, manual is user-
 * controlled.
 */

import type {
	ExtensionContext,
	SessionCompactEvent,
} from "@earendil-works/pi-coding-agent";
import type { AutoCompactConfig } from "./config";

export const CONTINUE_TEXT =
	"Continue the task you were working on. Pick up exactly where you left off; " +
	"the earlier context is captured in the summary above.";

export type ResumeOutcomeKind =
	| "none"
	| "disabled"
	| "completed"
	| "budget"
	| "busy"
	| "stale"
	| "scheduled"
	| "skipped"
	| "failed";

export type ResumeState = {
	/** Compaction succeeded; resume owed when idle. */
	pending: boolean;
	/** True while a deferred resume timer is queued (blocks double schedule). */
	scheduleQueued: boolean;
	/** Branch leaf id at markAfterCompact; refuse fire if branch moved. */
	leafAtMark: string | null;
	/** Successful resume sends this session. */
	resumes: number;
	/** Last maybeFireResume outcome (status line). */
	lastOutcome: ResumeOutcomeKind;
};

export function createResumeState(): ResumeState {
	return {
		pending: false,
		scheduleQueued: false,
		leafAtMark: null,
		resumes: 0,
		lastOutcome: "none",
	};
}

export function resetResumeState(state: ResumeState): void {
	state.pending = false;
	state.scheduleQueued = false;
	state.leafAtMark = null;
	state.resumes = 0;
	state.lastOutcome = "none";
}

/** Drop pending on failed compaction so we never resume a failed path. */
export function clearResumeArm(state: ResumeState): void {
	state.pending = false;
	state.scheduleQueued = false;
	state.leafAtMark = null;
}

/**
 * After a successful NATIVE threshold compact (reason "threshold",
 * willRetry false): a resume is owed once the agent settles. Manual and
 * overflow compacts never arm.
 */
export function markAfterCompact(event: SessionCompactEvent, ctx: ExtensionContext, state: ResumeState): void {
	if (event.reason !== "threshold" || event.willRetry) return;
	state.pending = true;
	state.leafAtMark = ctx.sessionManager.getLeafId() ?? null;
}

function lastAssistantStopReason(ctx: ExtensionContext): string | undefined {
	const entries = ctx.sessionManager.getBranch();
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry?.type !== "message") continue;
		const message = entry.message;
		if (message.role === "assistant") return message.stopReason;
	}
	return undefined;
}

export type ResumeOutcome = { kind: ResumeOutcomeKind };

/**
 * Consume pending when idle. Call from session_compact and agent_settled.
 * Busy leaves pending for a later settle. Budget counts only after send.
 */
export function maybeFireResume(
	ctx: ExtensionContext,
	config: AutoCompactConfig,
	state: ResumeState,
	sendUserMessage: (text: string) => void,
	notify: (message: string, kind: "info" | "warning") => void,
): ResumeOutcome {
	if (!state.pending) {
		state.lastOutcome = "none";
		return { kind: "none" };
	}

	if (!config.autoResume) {
		state.pending = false;
		state.leafAtMark = null;
		state.lastOutcome = "disabled";
		return { kind: "disabled" };
	}

	if (!ctx.isIdle() || ctx.hasPendingMessages()) {
		state.lastOutcome = "busy";
		return { kind: "busy" };
	}

	if (state.leafAtMark != null && ctx.sessionManager.getLeafId() !== state.leafAtMark) {
		state.pending = false;
		state.leafAtMark = null;
		state.lastOutcome = "stale";
		return { kind: "stale" };
	}

	if (lastAssistantStopReason(ctx) !== "toolUse") {
		state.pending = false;
		state.leafAtMark = null;
		state.lastOutcome = "completed";
		return { kind: "completed" };
	}

	if (state.resumes >= config.maxResumes) {
		state.pending = false;
		state.leafAtMark = null;
		state.lastOutcome = "budget";
		notify(
			`auto-compact: auto-resume budget (${config.maxResumes}) reached; type "continue" to keep going`,
			"warning",
		);
		return { kind: "budget" };
	}

	// One deferred send at a time (session_compact + agent_settled both call).
	if (state.scheduleQueued) {
		state.lastOutcome = "scheduled";
		return { kind: "scheduled" };
	}

	const leaf = state.leafAtMark;
	state.scheduleQueued = true;
	state.lastOutcome = "scheduled";

	setTimeout(() => {
		state.scheduleQueued = false;
		if (!state.pending) return;
		if (!ctx.isIdle() || ctx.hasPendingMessages()) {
			// Leave pending for a later settle; do not burn budget.
			state.lastOutcome = "skipped";
			notify("auto-compact: resume deferred; session became busy", "info");
			return;
		}
		if (leaf != null && ctx.sessionManager.getLeafId() !== leaf) {
			state.pending = false;
			state.leafAtMark = null;
			state.lastOutcome = "stale";
			return;
		}
		if (lastAssistantStopReason(ctx) !== "toolUse") {
			state.pending = false;
			state.leafAtMark = null;
			state.lastOutcome = "completed";
			return;
		}
		if (state.resumes >= config.maxResumes) {
			state.pending = false;
			state.leafAtMark = null;
			state.lastOutcome = "budget";
			return;
		}
		try {
			sendUserMessage(CONTINUE_TEXT);
			state.pending = false;
			state.leafAtMark = null;
			state.resumes += 1;
			state.lastOutcome = "scheduled";
			notify("auto-compact: resuming interrupted task", "info");
		} catch (error: unknown) {
			state.pending = false;
			state.leafAtMark = null;
			state.lastOutcome = "failed";
			const message = error instanceof Error ? error.message : String(error);
			notify(`auto-compact: resume failed (${message}); type "continue" to retry`, "warning");
		}
	}, 0);

	return { kind: "scheduled" };
}
