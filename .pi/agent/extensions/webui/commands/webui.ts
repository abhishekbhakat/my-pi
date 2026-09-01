import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { loadCoreExportHtmlAssets } from "../core/assets";
import { openBrowser } from "../server/browser";
import { ensureWebUiServer } from "../server/http-server";
import { SSM_ORIGIN } from "../ssm/constants";
import { ensureSsmDaemon } from "../ssm/ensure-daemon";
import { registerLive } from "../ssm/live-client";
import type { WebUiRuntime } from "../runtime/types";
import { getCoreExportHtmlDir } from "../utils/path";

export function registerWebUiCommand(pi: ExtensionAPI, runtime: WebUiRuntime): void {
	pi.registerCommand("webui", {
		description: "Open live session UI (http://127.0.0.1:17300/)",
		handler: async (_args, ctx) => {
			try {
				getCoreExportHtmlDir();
				loadCoreExportHtmlAssets();
				await ensureSsmDaemon();

				const themeName = SettingsManager.create(ctx.cwd).getTheme();
				const { port } = await ensureWebUiServer(pi, runtime, ctx, themeName);
				await registerLive({
					port,
					pid: process.pid,
					id: ctx.sessionManager.getSessionId(),
					path: ctx.sessionManager.getSessionFile(),
					cwd: ctx.cwd,
				});

				ctx.ui.notify(`Web UI: ${SSM_ORIGIN}/live`, "info");
				await openBrowser(pi, `${SSM_ORIGIN}/live`);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Web UI failed: ${message}`, "error");
			}
		},
	});
}
