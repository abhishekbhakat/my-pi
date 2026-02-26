/**
 * Exit Command Extension
 *
 * Adds a /exit command that cleanly exits pi.
 * This is an alias for the built-in /quit command.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function exitExtension(pi: ExtensionAPI) {
	// Register a /exit command that cleanly exits pi
	// This is functionally identical to /quit
	pi.registerCommand("exit", {
		description: "Exit pi cleanly (alias for /quit)",
		handler: async (_args, ctx) => {
			ctx.shutdown();
		},
	});
}
