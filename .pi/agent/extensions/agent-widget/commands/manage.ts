import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadAllAgents } from "../agents";
import { widgetCtx, instances } from "../runtime";
import { getInstanceKey, spawnAgentInstance } from "../instance";
import { removeInstance, listActiveInstances, clearAll } from "../actions";
import { updateWidgets, scheduleWidgetUpdate } from "../widget-updater";

export function registerManageCommands(pi: ExtensionAPI) {
	pi.registerCommand("agentcont", {
		description: "Continue an agent: /agentcont <agent-name> <id> <prompt>",
		handler: async (args, ctx) => {
			widgetCtx.value = { ui: ctx.ui };

			const trimmed = args?.trim() ?? "";
			const parts = trimmed.split(/\s+/);
			if (parts.length < 3) {
				ctx.ui.notify("Usage: /agentcont <agent-name> <id> <prompt>", "error");
				return;
			}

			const agentName = parts[0];
			const id = parseInt(parts[1], 10);
			const prompt = parts.slice(2).join(" ");

			if (isNaN(id)) {
				ctx.ui.notify("Invalid ID. Usage: /agentcont <agent-name> <id> <prompt>", "error");
				return;
			}

			const key = getInstanceKey(agentName, id);
			const existing = instances.get(key);

			if (!existing) {
				ctx.ui.notify(`No ${agentName} #${id} found.`, "error");
				return;
			}

			if (existing.status === "running") {
				ctx.ui.notify(`${agentName} #${id} is still running.`, "warning");
				return;
			}

			existing.status = "running";
			existing.task = prompt;
			existing.textChunks = [];
			existing.elapsed = 0;
			existing.turnCount++;
			updateWidgets();

			ctx.ui.notify(`Continuing ${existing.def.name} #${existing.id} (Turn ${existing.turnCount})...`, "info");

			const callbacks = {
				onTextDelta: () => scheduleWidgetUpdate(),
				onToolStart: () => scheduleWidgetUpdate(),
				onStatusChange: () => updateWidgets(),
			};

			spawnAgentInstance(existing, prompt, callbacks);
		},
	});

	pi.registerCommand("agentrm", {
		description: "Remove an agent: /agentrm <agent-name> <id>",
		handler: async (args, ctx) => {
			widgetCtx.value = { ui: ctx.ui };

			const parts = args?.trim().split(/\s+/) ?? [];
			if (parts.length !== 2) {
				ctx.ui.notify("Usage: /agentrm <agent-name> <id>", "error");
				return;
			}

			const agentName = parts[0];
			const id = parseInt(parts[1], 10);

			if (isNaN(id)) {
				ctx.ui.notify("Invalid ID", "error");
				return;
			}

			const inst = removeInstance(agentName, id);

			if (!inst) {
				ctx.ui.notify(`No ${agentName} #${id} found.`, "error");
				return;
			}

			if (inst.proc && inst.status === "running") {
				ctx.ui.notify(`${inst.def.name} #${inst.id} killed and removed.`, "warning");
			} else {
				ctx.ui.notify(`${inst.def.name} #${inst.id} removed.`, "info");
			}
		},
	});

	pi.registerCommand("agentclear", {
		description: "Clear all agent widgets",
		handler: async (_args, ctx) => {
			widgetCtx.value = { ui: ctx.ui };

			const { count, killed } = clearAll();
			ctx.ui.setWidget("agent-grid", undefined);

			const msg = count === 0
				? "No agents to clear."
				: `Cleared ${count} agent${count !== 1 ? "s" : ""}${killed > 0 ? ` (${killed} killed)` : ""}.`;
			ctx.ui.notify(msg, count === 0 ? "info" : "success");
		},
	});

	pi.registerCommand("agents-list", {
		description: "List available agent definitions",
		handler: async (_args, ctx) => {
			const allAgents = loadAllAgents();
			if (allAgents.size === 0) {
				ctx.ui.notify("No agents found in ~/.pi/agents/", "warning");
				return;
			}

			const lines = Array.from(allAgents.values())
				.map(def => {
					const modelShort = def.model.split("/").pop() || def.model;
					return `• ${def.name} (${modelShort})\n  ${def.description}`;
				})
				.join("\n\n");

			ctx.ui.notify(`Available agents:\n\n${lines}`, "info");
		},
	});
}
