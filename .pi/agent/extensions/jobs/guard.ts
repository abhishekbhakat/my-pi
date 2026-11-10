/**
 * Command guards. Every rule exists because a duration was guessed or an exit code
 * was thrown away. Foreground bash may not sleep at all; a spawned job may sleep
 * only inside a retry loop, which ends on a condition instead of a clock.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const CMD_START = String.raw`(?:^|[;&|({]\s*|\b(?:env|sudo|xargs|command|exec)\s+)`;
const DETACH = new RegExp(CMD_START + String.raw`(?:nohup|setsid|disown)\b`);
const TIMEOUT_COMMAND = new RegExp(CMD_START + String.raw`(?:timeout|gtimeout)\b`);
const SLEEP = /(?:^|[;&|(){}\n]|\bthen\b|\bdo\b|\belse\b)\s*sleep\s+\d/;
const LONE_AMPERSAND = /(?<![&>])&(?![&>])/;
const RETRY_LOOP = /\b(?:until|while)\b/;

export const SPAWN_HINT = 'Use jobs spawn "<command>". Exit wakes you with the code and output.';

/**
 * Stop idle polling of the same jobs call with the same parameters.
 * Only `jobs output` repeats count (`jobs list` is never blocked). Any
 * other call, or an output call with different parameters, breaks the streak.
 * Jobs themselves keep running; the exit wake starts a fresh run.
 */
export function registerIdlePollingGuard(pi: ExtensionAPI): void {
	let sessionId: string | undefined;
	let streak = 0;
	let lastKey: string | undefined;
	let turnIndex = 0;
	let lastCountedTurn = -1;
	let stopped = false;
	const wrappers = new Map<string, boolean>();

	function breakStreak(): void {
		streak = 0;
		lastKey = undefined;
		lastCountedTurn = -1;
	}

	function reset(): void {
		streak = 0;
		lastKey = undefined;
		turnIndex = 0;
		lastCountedTurn = -1;
		stopped = false;
		wrappers.clear();
	}

	function jobStatusKey(name: string, input: unknown): string | undefined {
		if (name !== "jobs") return undefined;
		const args = input as { action?: unknown; id?: unknown } | null;
		const action = args?.action;
		if (action !== "output") return undefined;
		// Jobs parameters are scalar. Sorting keys makes property order irrelevant,
		// while changes to id, action, lines, or any other parameter break the streak.
		return JSON.stringify(Object.entries(input as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
	}

	pi.on("input", () => reset());
	pi.on("agent_start", () => reset());
	pi.on("session_start", (_event, ctx) => { sessionId = ctx.sessionManager.getSessionId(); reset(); });
	pi.on("session_before_switch", () => reset());
	pi.on("session_shutdown", () => reset());
	pi.on("message_start", (event) => {
		const message = event.message;
		if (message.role === "user" || (message.role === "custom" &&
			(message.customType === "pi_job_exit" || message.customType === "capability_result"))) reset();
	});
	pi.on("turn_start", () => { turnIndex++; });
	pi.on("tool_execution_end", (event) => {
		if (!wrappers.has(event.toolCallId)) return;
		if (!wrappers.get(event.toolCallId)) breakStreak();
		wrappers.delete(event.toolCallId);
	});
	pi.on("tool_call", (event, ctx) => {
		if (ctx.mode === "print" || ctx.mode === "json" || process.env.PI_CAPABILITY_CHILD === "1") return;
		const currentSession = ctx.sessionManager.getSessionId();
		if (sessionId !== currentSession) { sessionId = currentSession; reset(); }
		if (stopped) return { block: true, terminate: true, reason: "Response stopped after repeated identical jobs status polling." };
		if (event.parentToolCallId && wrappers.has(event.parentToolCallId)) wrappers.set(event.parentToolCallId, true);
		// Codemode is a transparent wrapper. Nested calls determine the streak;
		// a script with no tool calls breaks it when the wrapper finishes.
		if (event.toolName === "codemode") { wrappers.set(event.toolCallId, false); return; }
		const key = jobStatusKey(event.toolName, event.input);
		if (key === undefined) { breakStreak(); return; }
		// Parallel siblings in one assistant message count once. Nested calls
		// (e.g. a codemode loop polling) count each time, so they cannot hide.
		if (!event.parentToolCallId && lastCountedTurn === turnIndex && lastKey === key) return;
		if (key === lastKey) streak++;
		else { streak = 1; lastKey = key; }
		lastCountedTurn = turnIndex;
		if (streak < 2) return;
		stopped = true;
		const input = event.input as { action: string; id?: string };
		const target = `jobs ${input.action}${input.id ? ` ${input.id}` : ""}`;
		const reason = `Repeated identical status polling blocked (${target}). End the turn and wait for the completion wake. Background work was not cancelled.`;
		// abort() is synchronous at this API boundary. Do not await session idle
		// from inside a tool hook; the blocked call must finalize first.
		ctx.abort();
		ctx.ui.notify(`Stopped idle job polling (${target}). Background work was not cancelled.`, "warning");
		return { block: true, terminate: true, reason };
	});
}

function stripQuoted(command: string): string {
	return command.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
}

function checkCommon(command: string): string | undefined {
	if (command.trim().length === 0) return undefined;
	const bare = stripQuoted(command);
	if (DETACH.test(bare)) {
		return `nohup/setsid/disown hides the exit code. ${SPAWN_HINT}`;
	}
	if (TIMEOUT_COMMAND.test(bare)) {
		return `timeout/gtimeout guesses a duration and kills work that was about to finish. ${SPAWN_HINT}`;
	}
	if (LONE_AMPERSAND.test(bare)) {
		return `A single & throws away the exit code and output. ${SPAWN_HINT}`;
	}
	return undefined;
}

/** Foreground bash: no sleep at all. A retry loop belongs in a job. */
export function checkBashCommand(command: string): string | undefined {
	const common = checkCommon(command);
	if (common) return common;
	if (SLEEP.test(stripQuoted(command))) {
		return `sleep guesses a duration and always guesses wrong. ${SPAWN_HINT} For a readiness check, spawn a loop: jobs spawn "until <probe>; do sleep 0.2; done".`;
	}
	return undefined;
}

/** Spawned job: a retry loop is the correct pattern, a bare sleep is not. */
export function checkSpawnCommand(command: string): string | undefined {
	const common = checkCommon(command);
	if (common) return common;
	const bare = stripQuoted(command);
	if (SLEEP.test(bare) && !RETRY_LOOP.test(bare)) {
		return "A bare sleep inside a job still guesses a duration. Use a probe loop: until <probe>; do sleep 0.2; done.";
	}
	return undefined;
}
