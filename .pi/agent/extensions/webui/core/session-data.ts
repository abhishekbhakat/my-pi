import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { WebUiRuntime } from "../runtime/types";

function serializeTools(pi: ExtensionAPI) {
	return pi.getAllTools().map((tool) => ({
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters,
	}));
}

export function buildSessionData(pi: ExtensionAPI, ctx: ExtensionContext, runtime: WebUiRuntime) {
	return {
		header: ctx.sessionManager.getHeader(),
		entries: ctx.sessionManager.getEntries(),
		leafId: ctx.sessionManager.getLeafId(),
		systemPrompt: runtime.currentSystemPrompt,
		tools: serializeTools(pi),
		renderedTools: undefined,
	};
}
