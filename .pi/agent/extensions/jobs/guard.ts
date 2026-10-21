/**
 * Command guards. Every rule exists because a duration was guessed or an exit code
 * was thrown away. Foreground bash may not sleep at all; a spawned job may sleep
 * only inside a retry loop, which ends on a condition instead of a clock.
 */

const CMD_START = String.raw`(?:^|[;&|({]\s*|\b(?:env|sudo|xargs|command|exec)\s+)`;
const DETACH = new RegExp(CMD_START + String.raw`(?:nohup|setsid|disown)\b`);
const TIMEOUT_COMMAND = new RegExp(CMD_START + String.raw`(?:timeout|gtimeout)\b`);
const SLEEP = /(?:^|[;&|(){}\n]|\bthen\b|\bdo\b|\belse\b)\s*sleep\s+\d/;
const LONE_AMPERSAND = /(?<![&>])&(?![&>])/;
const RETRY_LOOP = /\b(?:until|while)\b/;

export const SPAWN_HINT = 'Use jobs spawn "<command>". Exit wakes you with the code and output.';

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
