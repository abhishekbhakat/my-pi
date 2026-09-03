/**
 * Delete Command Extension
 *
 * Adds /delete and /xdelete:
 * - /delete: permanently deletes current session file and starts fresh session.
 *   Nothing of old session remains in /resume picker or on disk.
 * - /xdelete: permanently deletes current session file and exits pi.
 *
 * Semantics:
 * - Deletes only exact file backing current session
 *   (ctx.sessionManager.getSessionFile()). Forked (/fork, /clone) sessions
 *   are separate files, so never touched.
 * - Permanent delete (fs.rmSync), no trash, no confirmation prompt.
 * - /delete: old session teardown (abort + flush + session_shutdown) happens
 *   inside ctx.newSession() before withSession runs, so file deleted only
 *   after pi fully released it and no re-append can recreate it.
 * - /xdelete: file deleted in session_shutdown (reason quit) after TUI
 *   teardown, so shutdown flush cannot recreate it.
 * - Non-persisted sessions (--no-session): nothing on disk, /delete starts
 *   new, /xdelete just exits.
 */

import { rmSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function deleteExtension(pi: ExtensionAPI) {
	let pendingDelete: string | null = null;

	// Runs after TUI teardown on quit. Delete here so shutdown flush
	// cannot recreate file afterwards.
	pi.on("session_shutdown", async (event) => {
		if (!pendingDelete) {
			return;
		}
		if (event.reason !== "quit") {
			pendingDelete = null;
			return;
		}
		const target = pendingDelete;
		pendingDelete = null;
		try {
			rmSync(target, { force: true });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`xdelete failed: ${message}`);
		}
	});

	pi.registerCommand("delete", {
		description: "Permanently delete current session and start a new one",
		handler: async (_args, ctx) => {
			// Capture before newSession(): the old ctx is stale afterwards.
			const oldSessionFile = ctx.sessionManager.getSessionFile();

			await ctx.newSession({
				withSession: async (freshCtx) => {
					if (!oldSessionFile) {
						freshCtx.ui.notify("New session started (previous session was not persisted)", "info");
						return;
					}
					try {
						rmSync(oldSessionFile, { force: true });
						freshCtx.ui.notify("Session deleted permanently. New session started.", "info");
					} catch (err) {
						const message = err instanceof Error ? err.message : String(err);
						freshCtx.ui.notify(`New session started, but delete failed: ${message}`, "warning");
					}
				},
			});
		},
	});

	pi.registerCommand("xdelete", {
		description: "Permanently delete current session and exit",
		handler: async (_args, ctx) => {
			const oldSessionFile = ctx.sessionManager.getSessionFile();
			if (!oldSessionFile) {
				ctx.shutdown();
				return;
			}
			pendingDelete = oldSessionFile;
			ctx.ui.notify("Session deleted permanently. Exiting.", "info");
			ctx.shutdown();
		},
	});
}
