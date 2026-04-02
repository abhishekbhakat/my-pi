/**
 * Clear Command Extension
 *
 * Adds a /clear command that clears the conversation history
 * by creating a new session (similar to /new).
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function clearExtension(pi: ExtensionAPI) {
	// Register a /clear command that clears conversation history
	pi.registerCommand("clear", {
		description: "Clear conversation history (alias for /new)",
		handler: async (_args, ctx) => {
			// Create a new session to clear history
			const result = await ctx.newSession();
			if (!result.cancelled) {
				ctx.ui.notify("Conversation history cleared", "info");
			}
		},
	});
}
