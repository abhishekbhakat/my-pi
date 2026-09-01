import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { openBrowser } from "../server/browser";
import { SSM_ORIGIN } from "../ssm/constants";
import { restartSsmDaemon } from "../ssm/ensure-daemon";
import type { WebUiRuntime } from "../runtime/types";

export function registerSsmCommand(pi: ExtensionAPI, _runtime: WebUiRuntime): void {
	pi.registerCommand("ssm", {
		description: "Restart SSM daemon and open http://127.0.0.1:17300/ssm",
		handler: async (_args, ctx) => {
			try {
				const health = await restartSsmDaemon();
				const url = `${SSM_ORIGIN}/ssm`;
				ctx.ui.notify(`SSM daemon restarted (pid ${health.pid}): ${url}`, "info");
				await openBrowser(pi, url);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`SSM failed: ${message}`, "error");
			}
		},
	});
}
