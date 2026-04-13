import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { loadCapabilityDefs } from "./definitions";
import { executeCapability } from "./runner";
import type { CapabilityDef, CapabilityToolInput } from "./types";

const CAPABILITY_INPUT_SCHEMA = Type.Object({
	task: Type.String({ description: "Question, objective, or request for the helper capability" }),
	paths: Type.Optional(Type.Array(Type.String({ description: "Relevant file or directory path" }))),
	includeConversation: Type.Optional(Type.Boolean({ description: "Override the capability default for recent conversation context" })),
	includeTree: Type.Optional(Type.Boolean({ description: "Override the capability default for workspace tree context" })),
	includeDiff: Type.Optional(Type.Boolean({ description: "Override the capability default for git diff context" })),
});

function registerCapabilityTool(pi: ExtensionAPI, def: CapabilityDef): void {
	pi.registerTool({
		name: def.toolName,
		label: def.label,
		description: def.description,
		promptSnippet: def.promptSnippet ?? def.description,
		promptGuidelines: def.promptGuidelines.length > 0 ? def.promptGuidelines : undefined,
		parameters: CAPABILITY_INPUT_SCHEMA,
		execute: async (_callId, args, signal, onUpdate, ctx) =>
			executeCapability(pi, def, args as CapabilityToolInput, signal, onUpdate, ctx),
	});
}

export default function (pi: ExtensionAPI) {
	const capabilities = loadCapabilityDefs();

	for (const capability of capabilities) {
		registerCapabilityTool(pi, capability);
	}

	pi.registerCommand("capabilities", {
		description: "List installed capability helper tools",
		handler: async (_args, ctx) => {
			if (capabilities.length === 0) {
				ctx.ui.notify("No capability tools found.", "warning");
				return;
			}

			const lines = capabilities
				.map((capability) => `${capability.toolName} (${capability.model})\n${capability.description}`)
				.join("\n\n");

			ctx.ui.notify(`Capability tools:\n\n${lines}`, "info");
		},
	});
}
