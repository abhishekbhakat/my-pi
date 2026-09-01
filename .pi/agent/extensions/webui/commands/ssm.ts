import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { openBrowser } from "../server/browser";
import { SSM_ORIGIN } from "../ssm/constants";
import { ensureSsmDaemon, restartSsmDaemon } from "../ssm/ensure-daemon";
import type { WebUiRuntime } from "../runtime/types";

let inFlight: Promise<unknown> | undefined;

export function registerSsmCommand(pi: ExtensionAPI, _runtime: WebUiRuntime): void {
	pi.registerCommand("ssm", {
		description: "Open http://127.0.0.1:17300/ssm (add -r to restart daemon)",
		handler: async (args, ctx) => {
			try {
				const force = /\b(-r|--restart)\b/.test(typeof args === "string" ? args : "");
				if (inFlight) await inFlight.catch(() => {});
				const pending = force ? restartSsmDaemon() : ensureSsmDaemon();
				inFlight = pending;
				const health = await pending.finally(() => {
					if (inFlight === pending) inFlight = undefined;
				});
				const url = `${SSM_ORIGIN}/ssm`;
				ctx.ui.notify(
					force ? `SSM daemon restarted (pid ${health.pid}): ${url}` : `SSM daemon already running (pid ${health.pid}): ${url}`,
					"info",
				);
				await openBrowser(pi, url);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`SSM failed: ${message}`, "error");
			}
		},
	});
}
