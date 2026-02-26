import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadAgent, loadAllAgents } from "../agents";
import { widgetCtx, instances } from "../runtime";
import { getInstanceKey, spawnAgentInstance } from "../instance";
import { createInstance, setPersistenceApi } from "../actions";
import { updateWidgets, scheduleWidgetUpdate } from "../widget-updater";
import { saveAgentState } from "../persistence";
import type { AgentInstance } from "../types";

// Track last save time to throttle persistence in spawn commands
let lastSpawnSave = 0;
const SPAWN_SAVE_THROTTLE = 2000;

function maybeSaveState(pi: ExtensionAPI): void {
	const now = Date.now();
	if (now - lastSpawnSave > SPAWN_SAVE_THROTTLE) {
		lastSpawnSave = now;
		// Import runtime maps directly to avoid circular issues
		const { instances: runtimeInstances, instanceIds } = require("../runtime");
		saveAgentState(pi, runtimeInstances, instanceIds);
	}
}

function makeCompletionCallback(pi: ExtensionAPI, inst: AgentInstance) {
	return {
		onTextDelta: () => scheduleWidgetUpdate(),
		onToolStart: () => scheduleWidgetUpdate(),
		onStatusChange: (status: "running" | "done" | "error") => {
			updateWidgets();
			if (status !== "running") {
				const result = inst.textChunks.join("");
				const summary = `${inst.def.name} #${inst.id}${inst.turnCount > 1 ? ` (Turn ${inst.turnCount})` : ""} finished in ${Math.round(inst.elapsed / 1000)}s.\n\nResult:\n${result.slice(0, 8000)}${result.length > 8000 ? "\n\n... [truncated]" : ""}`;
				pi.sendMessage({
					customType: "agent-result",
					content: summary,
					display: true,
				}, { deliverAs: "followUp", triggerTurn: true });
			}
		},
	};
}

export function registerSpawnCommands(pi: ExtensionAPI) {
	pi.registerCommand("agent", {
		description: "Spawn an agent: /agent <agent-name> <task>",
		handler: async (args, ctx) => {
			widgetCtx.value = { ui: ctx.ui };

			const trimmed = args?.trim() ?? "";
			const spaceIdx = trimmed.indexOf(" ");
			if (spaceIdx === -1) {
				ctx.ui.notify("Usage: /agent <agent-name> <task>", "error");
				return;
			}

			const agentName = trimmed.slice(0, spaceIdx);
			const task = trimmed.slice(spaceIdx + 1).trim();

			const def = loadAgent(agentName);
			if (!def) {
				const available = Array.from(loadAllAgents().keys()).join(", ");
				ctx.ui.notify(`Agent "${agentName}" not found. Available: ${available}`, "error");
				return;
			}

			const inst = createInstance(def, task);
			const key = getInstanceKey(def.name, inst.id);
			instances.set(key, inst);
			updateWidgets();

			ctx.ui.notify(`Spawning ${def.name} #${inst.id} (${def.model})...`, "info");

			const callbacks = makeCompletionCallback(pi, inst);
			spawnAgentInstance(inst, task, callbacks);

			// Trigger persistence
			maybeSaveState(pi);
		},
	});

	pi.registerCommand("agent-parallel", {
		description: "Spawn multiple agents in parallel: /agent-parallel <agent1,agent2,...> <task>",
		handler: async (args, ctx) => {
			widgetCtx.value = { ui: ctx.ui };

			const trimmed = args?.trim() ?? "";
			const spaceIdx = trimmed.indexOf(" ");
			if (spaceIdx === -1) {
				ctx.ui.notify("Usage: /agent-parallel <agent1,agent2,...> <task>", "error");
				return;
			}

			const agentsPart = trimmed.slice(0, spaceIdx);
			const task = trimmed.slice(spaceIdx + 1).trim();
			const agentNames = agentsPart.split(",").map(s => s.trim()).filter(Boolean);

			if (agentNames.length === 0) {
				ctx.ui.notify("Usage: /agent-parallel <agent1,agent2,...> <task>", "error");
				return;
			}

			const defs = [];
			for (const name of agentNames) {
				const def = loadAgent(name);
				if (!def) {
					const available = Array.from(loadAllAgents().keys()).join(", ");
					ctx.ui.notify(`Agent "${name}" not found. Available: ${available}`, "error");
					return;
				}
				defs.push(def);
			}

			const spawnedInstances = [];
			for (const def of defs) {
				const inst = createInstance(def, task);
				const key = getInstanceKey(def.name, inst.id);
				instances.set(key, inst);
				spawnedInstances.push(inst);
			}
			updateWidgets();

			ctx.ui.notify(`Spawning ${defs.length} agents in parallel...`, "info");

			for (const inst of spawnedInstances) {
				const callbacks = makeCompletionCallback(pi, inst);
				spawnAgentInstance(inst, task, callbacks);
			}

			// Trigger persistence
			maybeSaveState(pi);
		},
	});
}
