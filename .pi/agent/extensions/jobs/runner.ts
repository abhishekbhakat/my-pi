import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { jobPaths, pidAlive, pidOwner } from "./state.ts";

/**
 * The wrapper exists so the exit code survives a pi restart: `/reload` drops the
 * ChildProcess handle, but this file write does not. TERM is forwarded, never
 * recorded as an exit, so a command that ignores TERM keeps the grace period and
 * gets SIGKILL instead of a false "stopped".
 */
const WRAPPER = [
	// Function positionals shadow script positionals, so the exit path goes in a variable.
	"EXIT_FILE=$2",
	'finish() { printf %s "$1" > "$EXIT_FILE.tmp" && mv "$EXIT_FILE.tmp" "$EXIT_FILE"; exit 0; }',
	"trap 'kill -TERM $w 2>/dev/null' TERM",
	'bash -c "$1" & w=$!',
	"wait $w; c=$?",
	"while kill -0 $w 2>/dev/null; do wait $w; c=$?; done",
	'finish "$c"',
].join("; ");

const STOP_GRACE_MS = 5000;
const STOP_POLL_MS = 100;
const SIGTERM_CODE = 143;
const SIGKILL_CODE = 137;

export interface SpawnedJob {
	child: ChildProcess;
	pid: number | undefined;
}

export function spawnJob(root: string, id: string, command: string, cwd: string): SpawnedJob {
	const paths = jobPaths(root, id);
	const fd = openSync(paths.log, "a");
	try {
		const child = spawn("/bin/bash", ["-c", WRAPPER, "pijob", command, paths.exit], {
			cwd,
			detached: process.platform !== "win32",
			stdio: ["ignore", fd, fd],
			env: { ...process.env, PI_JOB_ID: id },
			windowsHide: true,
		});
		child.unref();
		return { child, pid: child.pid };
	} finally {
		closeSync(fd);
	}
}

export function killGroup(pid: number, signal: NodeJS.Signals): void {
	// pid 0 and negative targets would signal pi's own group.
	if (!Number.isInteger(pid) || pid <= 1) return;
	try {
		process.kill(process.platform === "win32" ? pid : -pid, signal);
	} catch {
		// Already gone.
	}
}

export interface TerminateResult {
	code: number;
	forced: boolean;
}

/** Ask the process group to stop, escalate to KILL after the grace period. */
export async function terminateJob(pid: number, waitForExit: () => Promise<number | undefined>): Promise<TerminateResult> {
	killGroup(pid, "SIGTERM");
	const deadline = Date.now() + STOP_GRACE_MS;
	let resent = false;
	while (Date.now() < deadline) {
		const code = await waitForExit();
		if (code !== undefined) return { code, forced: false };
		if (!pidAlive(pid)) {
			// A TERM that landed before the wrapper installed its trap kills it with no
			// exit file. Re-read once, then fall back to the shell convention.
			const late = await waitForExit();
			return { code: late ?? SIGTERM_CODE, forced: false };
		}
		// One resend covers a wrapper still installing its trap.
		if (!resent && Date.now() > deadline - STOP_GRACE_MS + 2 * STOP_POLL_MS) {
			killGroup(pid, "SIGTERM");
			resent = true;
		}
		await sleep(STOP_POLL_MS);
	}
	killGroup(pid, "SIGKILL");
	await sleep(2 * STOP_POLL_MS);
	return { code: SIGKILL_CODE, forced: true };
}

/** Refuse to kill a pid that now belongs to some other program. */
export async function ownsPid(pid: number): Promise<boolean> {
	return (await pidOwner(pid)) === "ours";
}

export async function sleep(ms: number): Promise<void> {
	await new Promise<void>((resolve) => {
		const timer = setTimeout(resolve, ms);
		timer.unref?.();
	});
}

/** Block a foreground caller until the wrapper records the exit code. */
export async function waitForExit(
	waitForExitFile: () => Promise<number | undefined>,
	signal?: AbortSignal,
): Promise<number | undefined> {
	while (!signal?.aborted) {
		const code = await waitForExitFile();
		if (code !== undefined) return code;
		await sleep(STOP_POLL_MS);
	}
	return undefined;
}
