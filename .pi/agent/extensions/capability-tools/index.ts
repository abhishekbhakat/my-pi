import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { registerCapabilityCommands } from "./commands";
import { BOOLEAN_GUY_DEF, BOOLEAN_GUY_SCHEMA, executeBooleanGuy } from "./booleanGuy";
import { loadCapabilityDefs } from "./definitions";
import { applyCapabilityPrune } from "./prune";
import { executeCapability } from "./runner";
import type { CapabilityDef, CapabilityToolInput } from "./types";

const CAPABILITY_INPUT_SCHEMA = Type.Object({
	task: Type.String({ description: "Question, objective, or request for the helper capability" }),
	paths: Type.Optional(Type.Array(Type.String({ description: "Relevant file or directory path" }))),
	includeConversation: Type.Optional(Type.Boolean({ description: "Override the capability default for recent conversation context" })),
	includeTree: Type.Optional(Type.Boolean({ description: "Override the capability default for workspace tree context" })),
	includeDiff: Type.Optional(Type.Boolean({ description: "Override the capability default for git diff context" })),
	includeTimeline: Type.Optional(Type.Boolean({ description: "Override the capability default for action timeline context" })),
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
	const listed = [...capabilities, BOOLEAN_GUY_DEF];
	const capabilityToolNames = listed.map((c) => c.toolName);

	for (const capability of capabilities) {
		registerCapabilityTool(pi, capability);
	}

	pi.registerTool({
		name: BOOLEAN_GUY_DEF.toolName,
		label: BOOLEAN_GUY_DEF.label,
		description: BOOLEAN_GUY_DEF.description,
		promptSnippet: BOOLEAN_GUY_DEF.promptSnippet,
		promptGuidelines: BOOLEAN_GUY_DEF.promptGuidelines,
		parameters: BOOLEAN_GUY_SCHEMA,
		execute: async (_callId, args, signal, onUpdate, ctx) =>
			executeBooleanGuy(pi, args as Parameters<typeof executeBooleanGuy>[1], signal, onUpdate, ctx),
	});

	registerCapabilityCommands(pi, capabilities);
	applyCapabilityPrune(pi, listed);

	function toggleCapabilities(): { enabled: boolean; names: string[] } {
		const active = pi.getActiveTools();
		const allActive = capabilityToolNames.every((name) => active.includes(name));

		if (allActive) {
			const filtered = active.filter((name) => !capabilityToolNames.includes(name));
			pi.setActiveTools(filtered);
			return { enabled: false, names: capabilityToolNames };
		}
		const merged = [...new Set([...active, ...capabilityToolNames])];
		pi.setActiveTools(merged);
		return { enabled: true, names: capabilityToolNames };
	}

	function setCapabilities(enable: boolean): { changed: boolean; names: string[] } {
		const active = pi.getActiveTools();

		if (enable) {
			const allActive = capabilityToolNames.every((name) => active.includes(name));
			if (allActive) return { changed: false, names: capabilityToolNames };
			const merged = [...new Set([...active, ...capabilityToolNames])];
			pi.setActiveTools(merged);
			return { changed: true, names: capabilityToolNames };
		}
		const noneActive = !capabilityToolNames.some((name) => active.includes(name));
		if (noneActive) return { changed: false, names: capabilityToolNames };
		const filtered = active.filter((name) => !capabilityToolNames.includes(name));
		pi.setActiveTools(filtered);
		return { changed: true, names: capabilityToolNames };
	}

	async function handleCapabilityCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
		if (capabilities.length === 0) {
			ctx.ui.notify("No capability tools found.", "warning");
			return;
		}

		const subcommand = args.trim().toLowerCase().split(/\s+/)[0] || "";

		// Bare /capability and /capabilities toggle, same as /intent.
		if (!subcommand || subcommand === "toggle") {
			const result = toggleCapabilities();
			const state = result.enabled ? "enabled" : "disabled";
			ctx.ui.notify(`Capability tools ${state}: ${result.names.join(", ")}`, "info");
			return;
		}

		if (subcommand === "list") {
			const active = pi.getActiveTools();
			const lines = listed
				.map((c) => {
					const status = active.includes(c.toolName) ? "[active]" : "[inactive]";
					return `${status} ${c.toolName} (${c.model})\n${c.description}`;
				})
				.join("\n\n");
			ctx.ui.notify(`Capability tools:\n\n${lines}`, "info");
			return;
		}

		if (subcommand === "on") {
			const result = setCapabilities(true);
			ctx.ui.notify(
				result.changed
					? `Capability tools enabled: ${result.names.join(", ")}`
					: "Capability tools are already enabled.",
				result.changed ? "info" : "warning",
			);
			return;
		}

		if (subcommand === "off") {
			const result = setCapabilities(false);
			ctx.ui.notify(
				result.changed
					? `Capability tools disabled: ${result.names.join(", ")}`
					: "Capability tools are already disabled.",
				result.changed ? "info" : "warning",
			);
			return;
		}

		ctx.ui.notify(
			`Unknown subcommand: "${subcommand}". Bare /capability toggles. Subcommands: list, toggle, on, off`,
			"warning",
		);
	}

	const commandOptions = {
		description: "Toggle capability helper tools (bare toggles; list, on, off)",
		getArgumentCompletions: (prefix: string) => {
			const subcommands = ["list", "toggle", "on", "off"];
			return subcommands
				.filter((cmd) => cmd.startsWith(prefix.toLowerCase()))
				.map((cmd) => ({
					value: cmd,
					label: cmd,
					description:
						cmd === "list"
							? "List capability tools"
							: cmd === "toggle"
								? "Toggle on/off"
								: cmd === "on"
									? "Enable"
									: "Disable",
				}));
		},
		handler: handleCapabilityCommand,
	};

	pi.registerCommand("capability", commandOptions);
	pi.registerCommand("capabilities", commandOptions);
}
