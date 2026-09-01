import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { openBrowser } from "../server/browser";
import { ensureWebUiServer } from "../server/http-server";
import { SSM_ORIGIN } from "../ssm/constants";
import { ensureSsmDaemon, restartSsmDaemon } from "../ssm/ensure-daemon";
import { registerLive } from "../ssm/live-client";
import type { WebUiRuntime } from "../runtime/types";

let inFlight: Promise<unknown> | undefined;

async function withDaemonLock<T>(run: () => Promise<T>): Promise<T> {
	if (inFlight) await inFlight.catch(() => {});
	const pending = run();
	inFlight = pending;
	try {
		return await pending;
	} finally {
		if (inFlight === pending) inFlight = undefined;
	}
}

/** After daemon restart, live Map is empty — put this pi back if UI server is up. */
async function reregisterLive(pi: ExtensionAPI, runtime: WebUiRuntime, ctx: ExtensionCommandContext): Promise<void> {
	const themeName = runtime.themeName;
	const { port } = await ensureWebUiServer(pi, runtime, ctx, themeName);
	await registerLive({
		port,
		pid: process.pid,
		id: ctx.sessionManager.getSessionId(),
		path: ctx.sessionManager.getSessionFile(),
		cwd: ctx.cwd,
	});
}

export function registerSsmCommand(pi: ExtensionAPI, runtime: WebUiRuntime): void {
	pi.registerCommand("ssm", {
		description: "Open session manager (http://127.0.0.1:17300/ssm)",
		handler: async (_args, ctx) => {
			try {
				const health = await withDaemonLock(() => ensureSsmDaemon());
				const url = `${SSM_ORIGIN}/ssm`;
				ctx.ui.notify(`SSM daemon (pid ${health.pid}): ${url}`, "info");
				await openBrowser(pi, url);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`SSM failed: ${message}`, "error");
			}
		},
	});

	pi.registerCommand("ssm-restart", {
		description: "Restart SSM daemon on 17300, re-register this session",
		handler: async (_args, ctx) => {
			try {
				const health = await withDaemonLock(() => restartSsmDaemon());
				await reregisterLive(pi, runtime, ctx);
				ctx.ui.notify(`SSM daemon restarted (pid ${health.pid})`, "info");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`SSM restart failed: ${message}`, "error");
			}
		},
	});
}
