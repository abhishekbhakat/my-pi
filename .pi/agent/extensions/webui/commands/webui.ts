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
		description: "Open this session's live UI on the SSM daemon",
		handler: async (_args, ctx) => {
			try {
				getCoreExportHtmlDir();
				loadCoreExportHtmlAssets();
				await ensureSsmDaemon();

				const themeName = SettingsManager.create(ctx.cwd).getTheme();
				const sessionId = ctx.sessionManager.getSessionId();
				const { port } = await ensureWebUiServer(pi, runtime, ctx, themeName);
				await registerLive({
					port,
					pid: process.pid,
					id: sessionId,
					path: ctx.sessionManager.getSessionFile(),
					cwd: ctx.cwd,
				});

				// Must include ?id= so daemon pickLive binds this session, not "last registered".
				const url = `${SSM_ORIGIN}/live?id=${encodeURIComponent(sessionId)}`;
				ctx.ui.notify(`Web UI: ${url}`, "info");
				await openBrowser(pi, url);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Web UI failed: ${message}`, "error");
			}
		},
	});
}
