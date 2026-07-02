import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
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
	const capabilityToolNames = capabilities.map((c) => c.toolName);

	for (const capability of capabilities) {
		registerCapabilityTool(pi, capability);
	}

	function toggleCapabilities(): { enabled: boolean; names: string[] } {
		const active = pi.getActiveTools();
		const allActive = capabilityToolNames.every((name) => active.includes(name));

		if (allActive) {
			// All are active, disable all
			const filtered = active.filter((name) => !capabilityToolNames.includes(name));
			pi.setActiveTools(filtered);
			return { enabled: false, names: capabilityToolNames };
		} else {
			// Not all active (or none active), enable all
			const merged = [...new Set([...active, ...capabilityToolNames])];
			pi.setActiveTools(merged);
			return { enabled: true, names: capabilityToolNames };
		}
	}

	function setCapabilities(enable: boolean): { changed: boolean; names: string[] } {
		const active = pi.getActiveTools();

		if (enable) {
			const allActive = capabilityToolNames.every((name) => active.includes(name));
			if (allActive) return { changed: false, names: capabilityToolNames };
			const merged = [...new Set([...active, ...capabilityToolNames])];
			pi.setActiveTools(merged);
			return { changed: true, names: capabilityToolNames };
		} else {
			const noneActive = !capabilityToolNames.some((name) => active.includes(name));
			if (noneActive) return { changed: false, names: capabilityToolNames };
			const filtered = active.filter((name) => !capabilityToolNames.includes(name));
			pi.setActiveTools(filtered);
			return { changed: true, names: capabilityToolNames };
		}
	}

	pi.registerCommand("capabilities", {
		description: "Manage capability helper tools (list, toggle, on, off)",
		getArgumentCompletions: (prefix: string) => {
			const subcommands = ["list", "toggle", "on", "off"];
			return subcommands
				.filter((cmd) => cmd.startsWith(prefix.toLowerCase()))
				.map((cmd) => ({
					value: cmd,
					label: cmd,
					description: cmd === "list" ? "List capability tools" : cmd === "toggle" ? "Toggle on/off" : cmd === "on" ? "Enable" : "Disable",
				}));
		},
		handler: async (args, ctx) => {
			if (capabilities.length === 0) {
				ctx.ui.notify("No capability tools found.", "warning");
				return;
			}

			const subcommand = args.trim().toLowerCase().split(/\s+/)[0] || "list";

			if (subcommand === "list") {
				const active = pi.getActiveTools();
				const lines = capabilities
					.map((c) => {
						const status = active.includes(c.toolName) ? "[active]" : "[inactive]";
						return `${status} ${c.toolName} (${c.model})\n${c.description}`;
					})
					.join("\n\n");
				ctx.ui.notify(`Capability tools:\n\n${lines}`, "info");
			} else if (subcommand === "toggle") {
				const result = toggleCapabilities();
				const state = result.enabled ? "enabled" : "disabled";
				ctx.ui.notify(`Capability tools ${state}: ${result.names.join(", ")}`, "info");
			} else if (subcommand === "on") {
				const result = setCapabilities(true);
				ctx.ui.notify(
					result.changed
						? `Capability tools enabled: ${result.names.join(", ")}`
						: "Capability tools are already enabled.",
					result.changed ? "info" : "warning",
				);
			} else if (subcommand === "off") {
				const result = setCapabilities(false);
				ctx.ui.notify(
					result.changed
						? `Capability tools disabled: ${result.names.join(", ")}`
						: "Capability tools are already disabled.",
					result.changed ? "info" : "warning",
				);
			} else {
				ctx.ui.notify(`Unknown subcommand: "${subcommand}". Use: list, toggle, on, off`, "warning");
			}
		},
	});
}
