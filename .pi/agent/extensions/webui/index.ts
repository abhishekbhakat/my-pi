import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerWebUiCommand } from "./commands/webui";
import { registerSessionEvents } from "./events/session";
import { createWebUiRuntime } from "./runtime/state";

export default function (pi: ExtensionAPI) {
	const runtime = createWebUiRuntime();

	registerWebUiCommand(pi, runtime);
	registerSessionEvents(pi, runtime);
}
