import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { loadAllAgents } from "../agents";
import { widgetCtx, spawnGate } from "../runtime";
import { removeInstance, listActiveInstances } from "../actions";

export function registerManageTools(pi: ExtensionAPI) {
	pi.registerTool({
		name: "agent_remove",
		label: "Remove Agent",
		description: "Remove a specific agent instance. Kills it if running.",
		parameters: Type.Object({
			agent: Type.String({ description: "Agent name" }),
			id: Type.Number({ description: "Instance ID" }),
		}),
		execute: async (_callId, args, _signal, _onUpdate, ctx) => {
			widgetCtx.value = { ui: ctx.ui };
			const inst = removeInstance(args.agent, args.id);

			if (!inst) {
				return { content: [{ type: "text", text: `No ${args.agent} #${args.id} found.` }] };
			}

			return { content: [{ type: "text", text: `${inst.def.name} #${inst.id} removed.` }] };
		},
	});

	pi.registerTool({
		name: "agent_list",
		label: "List Agents",
		description: "List all active agent instances. Use 'compact' format for quick checks (lightweight output).",
		parameters: Type.Object({
			format: Type.Optional(Type.String({ description: "Output format: 'compact' for quick summary, 'full' for details (default: 'compact')" })),
		}),
		execute: async (_callId, args) => {
			const active = listActiveInstances();

			// Reset spawn gate since user explicitly listed agents
			spawnGate.checked = true;

			if (active.length === 0) {
				return { content: [{ type: "text", text: "No active agents." }] };
			}

			const format = args.format === "full" ? "full" : "compact";

			if (format === "compact") {
				// Lightweight format for frequent checks
				const running = active.filter(i => i.status === "running");
				const done = active.filter(i => i.status !== "running");

				let result = "";
				if (running.length > 0) {
					result += `Running: ${running.map(i => `${i.def.name}#${i.id}`).join(", ")}`;
				}
				if (done.length > 0) {
					if (result) result += " | ";
					result += `Done: ${done.map(i => `${i.def.name}#${i.id}`).join(", ")}`;
				}
				return { content: [{ type: "text", text: result }] };
			}

			// Full format with details
			const list = active
				.map(i => `${i.def.name} #${i.id} [${i.status.toUpperCase()}] (Turn ${i.turnCount}) - ${i.task}`)
				.join("\n");

			return { content: [{ type: "text", text: `Active agents:\n${list}` }] };
		},
	});

	pi.registerTool({
		name: "agents_discover",
		label: "Discover Agents",
		description: "List all available agent definitions from ~/.pi/agents/. Use this to find out which agents exist before spawning.",
		parameters: Type.Object({}),
		execute: async () => {
			const allAgents = loadAllAgents();
			if (allAgents.size === 0) {
				return { content: [{ type: "text", text: "No agent definitions found in ~/.pi/agents/" }] };
			}
			const list = Array.from(allAgents.values())
				.map(def => `${def.name} (${def.model.split("/").pop()}): ${def.description}`)
				.join("\n");
			return { content: [{ type: "text", text: `Available agents:\n${list}` }] };
		},
	});
}
