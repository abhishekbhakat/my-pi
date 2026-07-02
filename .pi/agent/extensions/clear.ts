/**
 * Clear Command Extension
 *
 * Adds a /clear command that clears the conversation history
 * by creating a new session (similar to /new).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function clearExtension(pi: ExtensionAPI) {
	// Register a /clear command that clears conversation history
	pi.registerCommand("clear", {
		description: "Clear conversation history (alias for /new)",
		handler: async (_args, ctx) => {
			// Create a new session to clear history. After newSession(), the old
			// ctx is stale, so any post-replacement work must run inside
			// withSession and use the fresh ctx passed to that callback.
			await ctx.newSession({
				withSession: async (ctx) => {
					ctx.ui.notify("Conversation history cleared", "info");
				},
			});
		},
	});
}
