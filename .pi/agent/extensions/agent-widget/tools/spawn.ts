import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { loadAgent, loadAllAgents, AgentDef } from "../agents";
import { widgetCtx, spawnGate } from "../runtime";
import { spawnSingle, spawnParallel } from "../actions";
import { updateWidgets } from "../widget-updater";

function checkSpawnGate(): { blocked: true; result: string } | { blocked: false } {
	if (!spawnGate.checked) {
		spawnGate.checked = true;
		return {
			blocked: true,
			result: `[GATE: Check active agents first]\n\nBefore spawning a new agent, run agent_list to see active agents.\nIf a relevant agent exists, continue that agent instead of spawning a new one.`,
		};
	}
	return { blocked: false };
}

function resetSpawnGate(): void {
	spawnGate.checked = false;
}

export function registerSpawnTools(pi: ExtensionAPI) {
	pi.registerTool({
		name: "agent_spawn",
		label: "Spawn Agent",
		description: "Spawn an agent from ~/.pi/agents/*.md with its own model, tools, and system prompt. IMPORTANT: This tool BLOCKS until the agent completes and returns the result directly. The widget shows live progress while waiting. NOTE: First call lists active agents; second call spawns.",
		parameters: Type.Object({
			agent: Type.String({ description: "Agent name (must match .md file in ~/.pi/agents/)" }),
			task: Type.String({ description: "Task for the agent to perform" }),
		}),
		execute: async (_callId, args, _signal, _onUpdate, ctx) => {
			widgetCtx.value = { ui: ctx.ui };

			// Enforce spawn gate: must list agents first
			const gate = checkSpawnGate();
			if (gate.blocked) {
				return { content: [{ type: "text", text: gate.result }] };
			}

			const def = loadAgent(args.agent);
			if (!def) {
				const available = Array.from(loadAllAgents().keys()).join(", ");
				return { content: [{ type: "text", text: `Agent "${args.agent}" not found. Available: ${available}` }] };
			}

			const { inst, result } = await spawnSingle(def, args.task, _signal);

			// Reset gate after successful spawn to enforce check on next spawn
			resetSpawnGate();

			const summary = `${inst.def.name} #${inst.id}${inst.turnCount > 1 ? ` (Turn ${inst.turnCount})` : ""} finished in ${Math.round(inst.elapsed / 1000)}s.\n\nResult:\n${result}`;

			ctx.ui.notify(
				`${inst.def.name} #${inst.id} ${inst.status} in ${Math.round(inst.elapsed / 1000)}s`,
				inst.status === "done" ? "success" : "error"
			);

			return { content: [{ type: "text", text: summary }] };
		},
	});

	pi.registerTool({
		name: "agent_spawn_parallel",
		label: "Spawn Agents Parallel",
		description: "Spawn multiple agents in parallel with the same task. All agents run concurrently and this tool blocks until ALL complete, returning combined results. NOTE: First call lists active agents; second call spawns.",
		parameters: Type.Object({
			agents: Type.Array(
				Type.String({ description: "Agent name" }),
				{ description: "Array of agent names to spawn" }
			),
			task: Type.String({ description: "Task description for all agents" }),
		}),
		execute: async (_callId, args, _signal, _onUpdate, ctx) => {
			widgetCtx.value = { ui: ctx.ui };

			// Enforce spawn gate: must list agents first
			const gate = checkSpawnGate();
			if (gate.blocked) {
				return { content: [{ type: "text", text: gate.result }] };
			}

			const { agents: agentNames, task } = args as { agents: string[]; task: string };

			const defs: AgentDef[] = [];
			for (const name of agentNames) {
				const def = loadAgent(name);
				if (!def) {
					const available = Array.from(loadAllAgents().keys()).join(", ");
					return {
						content: [{ type: "text", text: `Agent "${name}" not found. Available: ${available}` }],
						details: { status: "error" },
					};
				}
				defs.push(def);
			}

			const { results } = await spawnParallel(defs, task, _signal);

			// Reset gate after successful spawn to enforce check on next spawn
			resetSpawnGate();

			const combined = results.join("\n\n---\n\n");

			return {
				content: [{ type: "text", text: combined }],
				details: { agents: agentNames, status: "done" },
			};
		},
	});
}
