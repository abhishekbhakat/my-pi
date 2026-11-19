/**
 * Command guards. Every rule exists because a duration was guessed or an exit code
 * was thrown away. Foreground bash may not sleep at all; a spawned job may sleep
 * only inside a retry loop, which ends on a condition instead of a clock.
 * Repeated status reads of active work return guidance without interrupting the response.
 */

import type { CapabilityStatusQuery } from "#capability-background";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const CMD_START = String.raw`(?:^|[;&|({]\s*|\b(?:env|sudo|xargs|command|exec)\s+)`;
const DETACH = new RegExp(CMD_START + String.raw`(?:nohup|setsid|disown)\b`);
const TIMEOUT_COMMAND = new RegExp(CMD_START + String.raw`(?:timeout|gtimeout)\b`);
const SLEEP = /(?:^|[;&|(){}\n]|\bthen\b|\bdo\b|\belse\b)\s*sleep\s+\d/;
const LONE_AMPERSAND = /(?<![&>])&(?![&>])/;
const RETRY_LOOP = /\b(?:until|while)\b/;

export const SPAWN_HINT = 'Use jobs spawn "<command>". Exit wakes you with the code and output.';

type Polls = { count: number; lastDirectTurn?: number };

function countPoll(polls: Polls, turn: number, nested: boolean, limit: number): boolean {
	if (nested || polls.lastDirectTurn !== turn) {
		polls.count = Math.min(polls.count + 1, limit);
		if (!nested) polls.lastDirectTurn = turn;
	}
	return polls.count >= limit;
}

function isActive(status: string): boolean {
	return status === "running" || status === "cancelling";
}

export function registerIdlePollingGuard(
	pi: ExtensionAPI,
	isRunningJob: (sessionId: string, id: string) => Promise<boolean>,
): void {
	let sessionId: string | undefined;
	let turn = 0;
	const shellPolls = new Map<string, Polls>();
	const capabilityPolls = new Map<string, Polls>();
	let capabilityList: (Polls & { snapshot: string }) | undefined;

	function reset(): void {
		shellPolls.clear();
		capabilityPolls.clear();
		capabilityList = undefined;
	}

	pi.on("input", () => reset());
	pi.on("session_start", (_event, ctx) => { sessionId = ctx.sessionManager.getSessionId(); reset(); });
	pi.on("session_before_switch", () => reset());
	pi.on("session_shutdown", () => reset());
	pi.on("message_start", (event) => {
		const message = event.message;
		if (message.role === "user") reset();
		if (message.role !== "custom") return;
		if (message.customType === "pi_job_exit") {
			const details = message.details as { ids?: string[]; stall?: boolean } | undefined;
			if (!details?.stall) for (const id of details?.ids ?? []) shellPolls.delete(id);
		} else if (message.customType === "capability_result") {
			const details = message.details as { id?: string } | undefined;
			if (details?.id) capabilityPolls.delete(details.id);
			capabilityList = undefined;
		}
	});
	pi.on("turn_start", () => { turn++; });
	pi.on("tool_call", async (event, ctx) => {
		if (ctx.mode === "print" || ctx.mode === "json" || process.env.PI_CAPABILITY_CHILD === "1") return;
		if (event.toolName !== "jobs" && event.toolName !== "capability_jobs") return;
		const { action, id } = event.input as { action?: string; id?: string };
		const shell = event.toolName === "jobs" && action === "output";
		const capability = event.toolName === "capability_jobs" && (action === "output" || action === "list");
		if (!shell && !capability) return;
		const currentSession = ctx.sessionManager.getSessionId();
		if (sessionId !== currentSession) { sessionId = currentSession; reset(); }
		// Parallel siblings count once per target. Codemode's nested calls count individually.
		const nested = Boolean(event.parentToolCallId);
		const blocked = (status: string) => ({
			block: true,
			reason: `${status} Finish this turn and wait for the completion message. Check status again only if the user asks.`,
		});

		if (shell) {
			const jobId = id?.trim();
			if (!jobId || !/^j\d+$/.test(jobId)) return;
			const polls = shellPolls.get(jobId) ?? { count: 0 };
			shellPolls.set(jobId, polls);
			if (!countPoll(polls, turn, nested, 2)) return;
			const running = await isRunningJob(currentSession, jobId);
			// Ignore an in-flight check if a wake or user input reset its allowance.
			if (shellPolls.get(jobId) !== polls) return;
			if (running) return blocked(`Job ${jobId} is still running.`);
			shellPolls.delete(jobId);
			return;
		}

		let snapshot: Parameters<CapabilityStatusQuery["reply"]>[0] | undefined;
		const query: CapabilityStatusQuery = { sessionId: currentSession, reply: (runs) => { snapshot = runs; } };
		pi.events.emit("capability:polling-status", query);
		// If the capability extension is not loaded, leave status handling to the tool.
		if (snapshot === undefined) return;
		if (action === "list") {
			if (!snapshot.some(([, status]) => isActive(status))) { capabilityList = undefined; return; }
			const key = JSON.stringify(snapshot);
			if (capabilityList?.snapshot !== key) capabilityList = { snapshot: key, count: 0 };
			if (countPoll(capabilityList, turn, nested, 3)) return blocked("Capability list is unchanged and work is still active.");
			return;
		}

		if (!id) return;
		const status = snapshot.find(([runId]) => runId === id)?.[1];
		if (status === undefined || !isActive(status)) { capabilityPolls.delete(id); return; }
		const polls = capabilityPolls.get(id) ?? { count: 0 };
		capabilityPolls.set(id, polls);
		if (countPoll(polls, turn, nested, 3)) return blocked(`Capability ${id} is still ${status}.`);
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
