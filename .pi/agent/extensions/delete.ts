/**
 * Delete Command Extension
 *
 * Adds a /delete command that permanently deletes the current session file
 * and immediately starts a fresh session. Nothing of the old session remains
 * in the /resume picker or on disk.
 *
 * Semantics:
 * - Deletes only the exact file backing the current session
 *   (ctx.sessionManager.getSessionFile()). Forked (/fork, /clone) sessions
 *   are separate files, so they are never touched.
 * - Permanent delete (fs.rmSync), no trash, no confirmation prompt.
 * - Old session teardown (abort + flush + session_shutdown) happens inside
 *   ctx.newSession() before withSession runs, so the file is deleted only
 *   after pi has fully released it and no re-append can recreate it.
 * - Non-persisted sessions (--no-session): nothing on disk, just start new.
 */

import { rmSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function deleteExtension(pi: ExtensionAPI) {
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
}
