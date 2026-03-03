import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { loadAgent, loadAllAgents, AgentDef } from "../agents";
import { widgetCtx, instances, spawnGate } from "../runtime";
import { spawnSingle, continueInstance } from "../actions";

const SPAWN_GATE_TEXT = `[GATE: Check active agents first]\n\nBefore spawning a new agent, run agent_list to see active agents.\nIf a relevant agent exists, continue that agent instead of spawning a new one.`;

interface ParallelSendPlan {
	index: number;
	agentName: string;
	task: string;
	def: AgentDef;
	mode: "continue" | "spawn";
	targetId?: number;
}

function spawnGateBlockedResponse() {
	return {
		content: [{
			type: "text",
			text: SPAWN_GATE_TEXT,
		}],
	};
}

function findMostRecentContinuableInstanceId(agentName: string): number | null {
	let targetId: number | null = null;
	let maxId = -1;

	for (const [_key, inst] of instances) {
		if (inst.def.name.toLowerCase() === agentName.toLowerCase() && inst.status !== "running") {
			if (inst.id > maxId) {
				maxId = inst.id;
				targetId = inst.id;
			}
		}
	}

	return targetId;
}

function collectContinuableIdsByAgent(): Map<string, number[]> {
	const idsByAgent = new Map<string, number[]>();

	for (const inst of instances.values()) {
		if (inst.status === "running") continue;
		const key = inst.def.name.toLowerCase();
		const ids = idsByAgent.get(key) ?? [];
		ids.push(inst.id);
		idsByAgent.set(key, ids);
	}

	for (const ids of idsByAgent.values()) {
		ids.sort((a, b) => b - a);
	}

	return idsByAgent;
}

function runWithDelay<T>(delayMs: number, action: () => Promise<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		setTimeout(() => {
			action().then(resolve).catch(reject);
		}, delayMs);
	});
}

export function registerSendTool(pi: ExtensionAPI) {
	pi.registerTool({
		name: "agent_send",
		label: "Send to Agent",
		description: "Send a task to an agent. REQUIRED: First run agent_list to check for existing agents. If a relevant agent exists and is not running, it will be continued automatically. Only use new=true to force spawning a fresh agent instance if no suitable agent exists.",
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
					return spawnGateBlockedResponse();
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
			const targetId = findMostRecentContinuableInstanceId(agentName);

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
				return spawnGateBlockedResponse();
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

	pi.registerTool({
		name: "agent_send_parallel",
		label: "Send to Agents Parallel",
		description: "Send different tasks to multiple agents in parallel using a task map ({ agentName: task }). REQUIRED: First run agent_list to check for existing agents. Existing non-running agents will be continued automatically. Only use new=true to force spawning fresh instances if no suitable agents exist.",
		parameters: Type.Object({
			tasks: Type.Record(
				Type.String({ description: "Agent name/type (must match .md file in ~/.pi/agents/)" }),
				Type.String({ description: "Task or prompt for this agent" }),
				{ description: "Dictionary mapping agent names to tasks" }
			),
			new: Type.Optional(Type.Boolean({ description: "If true, spawn new instances for all agents. If false (default), continue most recent existing instance when available." })),
		}),
		execute: async (_callId, args, _signal, _onUpdate, ctx) => {
			widgetCtx.value = { ui: ctx.ui };

			const taskMap = args.tasks as Record<string, string>;
			const forceNew = args.new ?? false;
			const taskEntries = Object.entries(taskMap);

			if (taskEntries.length === 0) {
				return {
					content: [{ type: "text", text: "At least one agent task is required." }],
					details: { status: "error" },
				};
			}

			const requestedAgents: string[] = [];
			const requestedDefs: Array<{ index: number; agentName: string; task: string; def: AgentDef }> = [];

			for (const [index, [agentName, task]] of taskEntries.entries()) {
				const def = loadAgent(agentName);
				if (!def) {
					const available = Array.from(loadAllAgents().keys()).join(", ");
					return {
						content: [{ type: "text", text: `Agent "${agentName}" not found. Available: ${available}` }],
						details: { status: "error" },
					};
				}

				requestedAgents.push(agentName);
				requestedDefs.push({ index, agentName, task, def });
			}

			const continuableIds = collectContinuableIdsByAgent();
			const plans: ParallelSendPlan[] = requestedDefs.map(({ index, agentName, task, def }) => {
				if (!forceNew) {
					const ids = continuableIds.get(def.name.toLowerCase());
					if (ids && ids.length > 0) {
						const targetId = ids.shift();
						if (targetId !== undefined) {
							return {
								index,
								agentName,
								task,
								def,
								mode: "continue",
								targetId,
							};
						}
					}
				}

				return {
					index,
					agentName,
					task,
					def,
					mode: "spawn",
				};
			});

			const continuePlans = plans.filter((plan) => plan.mode === "continue");
			const spawnPlans = plans.filter((plan) => plan.mode === "spawn");

			if (spawnPlans.length > 0 && !spawnGate.checked) {
				return spawnGateBlockedResponse();
			}

			const continuePromise = Promise.all(
				continuePlans.map((plan, index) =>
					runWithDelay(index * 150, async () => {
						const targetId = plan.targetId as number;
						const continued = await continueInstance(plan.def.name, targetId, plan.task, _signal);
						return {
							index: plan.index,
							def: plan.def,
							targetId,
							continued,
						};
					})
				)
			);

			const spawnPromise = Promise.all(
				spawnPlans.map((plan, index) =>
					runWithDelay(index * 150, async () => {
						const { inst, result } = await spawnSingle(plan.def, plan.task, _signal);
						return {
							index: plan.index,
							inst,
							result,
						};
					})
				)
			);

			const [continuedOutcomes, spawnedOutcomes] = await Promise.all([continuePromise, spawnPromise]);

			if (spawnPlans.length > 0) {
				spawnGate.checked = false;
			}

			const summaryByIndex = new Map<number, string>();

			for (const outcome of continuedOutcomes) {
				if (!outcome.continued) {
					summaryByIndex.set(
						outcome.index,
						`${outcome.def.name} #${outcome.targetId} could not be continued.\n\nResult:\nNo result.`
					);
					ctx.ui.notify(`${outcome.def.name} #${outcome.targetId} could not be continued.`, "warning");
					continue;
				}

				const { inst, result } = outcome.continued;
				ctx.ui.notify(`${inst.def.name} #${inst.id} continued (Turn ${inst.turnCount})`, "info");

				summaryByIndex.set(
					outcome.index,
					`${inst.def.name} #${inst.id} (Turn ${inst.turnCount}) finished in ${Math.round(inst.elapsed / 1000)}s.\n\nResult:\n${result}`
				);
			}

			for (const spawned of spawnedOutcomes) {
				const { inst, index, result } = spawned;

				ctx.ui.notify(
					`${inst.def.name} #${inst.id} ${inst.status} in ${Math.round(inst.elapsed / 1000)}s`,
					inst.status === "done" ? "success" : "error"
				);

				summaryByIndex.set(
					index,
					`${inst.def.name} #${inst.id}${inst.turnCount > 1 ? ` (Turn ${inst.turnCount})` : ""} finished in ${Math.round(inst.elapsed / 1000)}s.\n\nResult:\n${result}`
				);
			}

			const combined = plans
				.sort((a, b) => a.index - b.index)
				.map((plan) => summaryByIndex.get(plan.index) ?? `${plan.def.name} had no result.`)
				.join("\n\n---\n\n");

			return {
				content: [{ type: "text", text: combined }],
				details: { agents: requestedAgents, status: "done" },
			};
		},
	});
}
