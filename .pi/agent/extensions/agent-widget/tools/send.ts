import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { loadAgent, loadAllAgents } from "../agents";
import { widgetCtx, instances, spawnGate } from "../runtime";
import { spawnSingle, continueInstance } from "../actions";

export function registerSendTool(pi: ExtensionAPI) {
	pi.registerTool({
		name: "agent_send",
		label: "Send to Agent",
		description: "Send a task to an agent. By default continues the most recent existing agent of the specified type (promotes reuse). Set new=true to force spawning a fresh agent instance.",
		parameters: Type.Object({
			agent: Type.String({ description: "Agent name/type (must match .md file in ~/.pi/agents/)" }),
			task: Type.String({ description: "Task or prompt to send to the agent" }),
			new: Type.Optional(Type.Boolean({ description: "If true, spawn a new agent instance. If false (default), continue the most recent existing agent of this type." })),
		}),
		execute: async (_callId, args, _signal, _onUpdate, ctx) => {
			widgetCtx.value = { ui: ctx.ui };

			const agentName = args.agent;
			const task = args.task;
			const forceNew = args.new ?? false;

			// Validate agent exists
			const def = loadAgent(agentName);
			if (!def) {
				const available = Array.from(loadAllAgents().keys()).join(", ");
				return { content: [{ type: "text", text: `Agent "${agentName}" not found. Available: ${available}` }] };
			}

			// If forcing new, spawn immediately
			if (forceNew) {
				// Enforce spawn gate: must list agents first
				if (!spawnGate.checked) {
					return {
						content: [{
							type: "text",
							text: `[GATE: Check active agents first]\n\nBefore spawning a new agent, run agent_list to see active agents.\nIf a relevant agent exists, continue that agent instead of spawning a new one.`
						}]
					};
				}

				const { inst, result } = await spawnSingle(def, task, _signal);
				spawnGate.checked = false; // Reset gate after spawn

				const summary = `${inst.def.name} #${inst.id}${inst.turnCount > 1 ? ` (Turn ${inst.turnCount})` : ""} finished in ${Math.round(inst.elapsed / 1000)}s.\n\nResult:\n${result}`;

				ctx.ui.notify(
					`${inst.def.name} #${inst.id} ${inst.status} in ${Math.round(inst.elapsed / 1000)}s`,
					inst.status === "done" ? "success" : "error"
				);

				return { content: [{ type: "text", text: summary }] };
			}

			// Try to find the most recent (largest ID) non-running agent of this type
			let targetId: number | null = null;
			let maxId = -1;

			for (const [key, inst] of instances) {
				if (inst.def.name.toLowerCase() === agentName.toLowerCase() && inst.status !== "running") {
					if (inst.id > maxId) {
						maxId = inst.id;
						targetId = inst.id;
					}
				}
			}

			// If found, continue it
			if (targetId !== null) {
				const result = await continueInstance(agentName, targetId, task, _signal);

				if (result) {
					ctx.ui.notify(
						`${result.inst.def.name} #${result.inst.id} continued (Turn ${result.inst.turnCount})`,
						"info"
					);

					const summary = `${result.inst.def.name} #${result.inst.id} (Turn ${result.inst.turnCount}) finished in ${Math.round(result.inst.elapsed / 1000)}s.\n\nResult:\n${result.result}`;
					return { content: [{ type: "text", text: summary }] };
				}
			}

			// No existing agent to continue - spawn new (with gate check)
			if (!spawnGate.checked) {
				return {
					content: [{
						type: "text",
						text: `[GATE: Check active agents first]\n\nBefore spawning a new agent, run agent_list to see active agents.\nIf a relevant agent exists, continue that agent instead of spawning a new one.`
					}]
				};
			}

			ctx.ui.notify(`No existing ${agentName} agent to continue. Spawning new...`, "info");

			const { inst, result } = await spawnSingle(def, task, _signal);
			spawnGate.checked = false; // Reset gate after spawn

			const summary = `${inst.def.name} #${inst.id}${inst.turnCount > 1 ? ` (Turn ${inst.turnCount})` : ""} finished in ${Math.round(inst.elapsed / 1000)}s.\n\nResult:\n${result}`;

			ctx.ui.notify(
				`${inst.def.name} #${inst.id} ${inst.status} in ${Math.round(inst.elapsed / 1000)}s`,
				inst.status === "done" ? "success" : "error"
			);

			return { content: [{ type: "text", text: summary }] };
		},
	});
}
