import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { SettingsManager } from "@mariozechner/pi-coding-agent";
import { openBrowser } from "../server/browser";
import { ensureWebUiServer } from "../server/http-server";
import type { WebUiRuntime } from "../runtime/types";

export function registerWebUiCommand(pi: ExtensionAPI, runtime: WebUiRuntime): void {
	pi.registerCommand("webui", {
		description: "Launch a browser UI backed by the current pi session",
		handler: async (_args, ctx) => {
			const settings = SettingsManager.create(ctx.cwd);
			const themeName = settings.getTheme();
			runtime.currentContext = ctx;
			runtime.currentSessionManager = ctx.sessionManager;
			runtime.cwd = ctx.cwd;
			runtime.abortCurrent = () => ctx.abort();
			const url = await ensureWebUiServer(pi, runtime, ctx, themeName);
			ctx.ui.notify(`Web UI ready: ${url}`, "info");
			await openBrowser(pi, url);
		},
	});
}
