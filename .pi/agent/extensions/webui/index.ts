import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerSsmCommand } from "./commands/ssm";
import { registerWebUiCommand } from "./commands/webui";
import { registerSessionEvents } from "./events/session";
import { createWebUiRuntime } from "./runtime/state";

export default function (pi: ExtensionAPI) {
	const runtime = createWebUiRuntime();

	registerWebUiCommand(pi, runtime);
	registerSsmCommand(pi, runtime);
	registerSessionEvents(pi, runtime);
}
