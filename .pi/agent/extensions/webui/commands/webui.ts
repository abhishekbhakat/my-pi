import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { loadCoreExportHtmlAssets } from "../core/assets";
import { openBrowser } from "../server/browser";
import { ensureWebUiServer } from "../server/http-server";
import type { WebUiRuntime } from "../runtime/types";
import { getCoreExportHtmlDir } from "../utils/path";

export function registerWebUiCommand(pi: ExtensionAPI, runtime: WebUiRuntime): void {
	pi.registerCommand("webui", {
		description: "Launch a browser UI backed by the current pi session",
		handler: async (_args, ctx) => {
			try {
				// Fail fast with a clear message before starting the server/browser.
				getCoreExportHtmlDir();
				loadCoreExportHtmlAssets();

				const settings = SettingsManager.create(ctx.cwd);
				const themeName = settings.getTheme();
				runtime.currentContext = ctx;
				runtime.currentSessionManager = ctx.sessionManager;
				runtime.cwd = ctx.cwd;
				runtime.abortCurrent = () => ctx.abort();

				const url = await ensureWebUiServer(pi, runtime, ctx, themeName);
				ctx.ui.notify(`Web UI ready: ${url}`, "info");
				await openBrowser(pi, url);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Web UI failed: ${message}`, "error");
			}
		},
	});
}
