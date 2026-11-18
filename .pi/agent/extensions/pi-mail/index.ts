import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getMailDir } from "./mail/mailbox.ts";
import { registerMail } from "./mail/tool.ts";
import { assignSessionName, releaseSessionName } from "./names/registry.ts";
import { registerPager } from "./pager/tool.ts";
import { registerUserMail } from "./user-mail/index.ts";

export default function piMailExtension(pi: ExtensionAPI) {
	registerUserMail(pi);
	registerMail(pi);
	const pager = registerPager(pi);

	let registered: { mailDir: string; id: string } | undefined;
	pi.on("session_start", async (_event, ctx) => {
		const mailDir = getMailDir();
		const id = ctx.sessionManager.getSessionId();
		const presence = await pager.start(ctx, mailDir, id).catch((error: unknown) => {
			if (ctx.hasUI) ctx.ui.notify(`Pager unavailable: ${error instanceof Error ? error.message : String(error)}`, "warning");
			return undefined;
		});
		try {
			const name = await assignSessionName(mailDir, id, ctx.cwd, presence);
			registered = name ? { mailDir, id } : undefined;
			if (ctx.hasUI) ctx.ui.setStatus("pi-mail", name);
		} catch (error) {
			await pager.stop().catch(() => {});
			if (ctx.hasUI) {
				ctx.ui.setStatus("pi-mail", undefined);
				ctx.ui.notify(`Pi mail names unavailable: ${error instanceof Error ? error.message : String(error)}. You can still use session IDs.`, "warning");
			}
		}
	});
	pi.on("session_shutdown", async (event, ctx) => {
		await pager.stop(event.reason === "quit").catch(() => {});
		// Reload and resume of the same session file keep this process's name.
		if (!registered || event.reason === "reload" ||
			(event.targetSessionFile && event.targetSessionFile === ctx.sessionManager.getSessionFile())) return;
		const { mailDir, id } = registered;
		registered = undefined;
		try {
			await releaseSessionName(mailDir, id);
		} catch {
			// Registration and PID checks recover claims missed during shutdown.
		}
	});
}
