import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerSendTool } from "./tools/send";
import { registerManageTools } from "./tools/manage";
import { registerSpawnCommands } from "./commands/spawn";
import { registerManageCommands } from "./commands/manage";
import { registerSessionEvents } from "./events/session";
import { setPersistenceApi } from "./actions";

/** Check if running inside a spawned agent (sub-agent) */
function isSubAgent(): boolean {
	return process.env.PI_AGENT_DEPTH !== undefined && process.env.PI_AGENT_DEPTH !== "0";
}

export default function (pi: ExtensionAPI) {
	// Set up persistence API reference
	setPersistenceApi(pi);

	// Only register tools/commands in the parent pi process
	// Sub-agents (spawned by agent-widget) should not have these tools
	if (!isSubAgent()) {
		registerSendTool(pi);
		registerManageTools(pi);
		registerSpawnCommands(pi);
		registerManageCommands(pi);
	}

	// Session events are always registered (for persistence/recovery)
	registerSessionEvents(pi);
}
