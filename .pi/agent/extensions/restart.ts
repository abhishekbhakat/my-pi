/**
 * Restart Command Extension
 *
 * Hard-restarts pi and resumes the current session:
 *   pi --session <session-id>
 *
 * Unlike /reload (in-process hot reload of resources), this launches a
 * fresh pi process after the TUI has been torn down, then waits for it so
 * the parent shell never reclaims the TTY mid-session.
 *
 * Note: built-in /reload cannot be overridden by extensions. Use /restart
 * when you need a full process restart (e.g. after trust changes, native
 * deps, or other state that /reload does not reset).
 */

import { execFileSync, spawn } from "node:child_process";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

type PendingRelaunch = {
	args: string[];
	cwd: string;
};

function buildRelaunchArgs(ctx: ExtensionCommandContext): string[] | undefined {
	const sm = ctx.sessionManager;
	if (!sm.isPersisted()) {
		return undefined;
	}
	if (!sm.getSessionFile()) {
		return undefined;
	}

	const args: string[] = [];
	if (!sm.usesDefaultSessionDir()) {
		args.push("--session-dir", sm.getSessionDir());
	}
	// Same shape as pi's own formatResumeCommand helper.
	args.push("--session", sm.getSessionId());
	return args;
}

/** Require `pi` on PATH. Throws if missing. */
function requirePiOnPath(): void {
	try {
		if (process.platform === "win32") {
			execFileSync("where.exe", ["pi"], { stdio: "ignore" });
		} else {
			execFileSync("which", ["pi"], { stdio: "ignore" });
		}
	} catch {
		throw new Error("`pi` not found on PATH");
	}
}

/**
 * Run a fresh pi as a foreground child and wait for it.
 *
 * Must only run after the TUI has stopped (session_shutdown on interactive
 * quit). Waiting keeps this process as the shell's direct child so the shell
 * does not reclaim the TTY while the new session is interactive.
 *
 * Do not use detached/setsid here: that creates a new session without a
 * controlling terminal, the parent shell becomes foreground again, and both
 * fight over stdin (raw/garbled keystrokes).
 */
function runForegroundPi(args: string[], cwd: string): Promise<number | null> {
	return new Promise((resolve) => {
		const child = spawn("pi", args, {
			cwd,
			stdio: "inherit",
			env: process.env,
		});
		child.on("error", (err) => {
			console.error(`Failed to relaunch pi: ${err.message}`);
			resolve(null);
		});
		child.on("close", (code) => resolve(code));
	});
}

export default function restartExtension(pi: ExtensionAPI) {
	let pendingRelaunch: PendingRelaunch | null = null;

	// Interactive quit stops the TUI before emitting session_shutdown, so by
	// the time we run here stdin is cooked again and free for the child.
	pi.on("session_shutdown", async (event) => {
		if (!pendingRelaunch) {
			return;
		}
		// Only relaunch on a real quit. Reload/new/resume/fork also emit this.
		if (event.reason !== "quit") {
			pendingRelaunch = null;
			return;
		}

		const { args, cwd } = pendingRelaunch;
		pendingRelaunch = null;
		await runForegroundPi(args, cwd);
	});

	pi.registerCommand("restart", {
		description: "Exit and relaunch pi, resuming the current session",
		handler: async (_args, ctx) => {
			const relaunchArgs = buildRelaunchArgs(ctx);
			if (!relaunchArgs) {
				ctx.ui.notify("Cannot restart: session is not persisted (--no-session)", "error");
				return;
			}

			try {
				requirePiOnPath();
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				ctx.ui.notify(`Cannot restart: ${message}`, "error");
				return;
			}

			const sessionId = ctx.sessionManager.getSessionId();
			pendingRelaunch = { args: relaunchArgs, cwd: ctx.cwd };
			ctx.ui.notify(`Restarting with session ${sessionId}...`, "info");

			// Graceful shutdown: drain input, stop TUI, then session_shutdown.
			ctx.shutdown();
		},
	});
}
