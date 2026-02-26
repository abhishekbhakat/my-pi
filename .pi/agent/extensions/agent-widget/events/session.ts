import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadAllAgents, loadAgent } from "../agents";
import { widgetCtx, instances, clearRuntimeState, restoreInstanceIds } from "../runtime";
import { loadAgentState, resetSavedState } from "../persistence";
import { updateWidgets } from "../widget-updater";
import { getInstanceKey } from "../instance";
import type { AgentInstance, PersistedAgentInstance } from "../types";

function clearAgents(ui: ExtensionAPI["ui"]) {
	for (const [_key, inst] of instances) {
		if (inst.proc && inst.status === "running") {
			inst.proc.kill("SIGTERM");
		}
	}
	clearRuntimeState();
	resetSavedState();
	ui.setWidget("agent-grid", undefined);
}

export function registerSessionEvents(pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		widgetCtx.value = { ui: ctx.ui };

		// Try to load persisted state
		const savedState = loadAgentState(ctx);

		if (savedState && savedState.instances.length > 0) {
			// Restore instance IDs counter
			if (savedState.instanceIds) {
				restoreInstanceIds(savedState.instanceIds);
			}

			// Restore agents directly into the active list
			let restoredCount = 0;
			for (const savedInst of savedState.instances) {
				const def = loadAgent(savedInst.defName);
				if (!def) continue;

				const inst: AgentInstance = {
					id: savedInst.id,
					def,
					status: savedInst.status,
					task: savedInst.task,
					textChunks: savedInst.textChunks,
					toolCount: savedInst.toolCount,
					elapsed: savedInst.elapsed,
					sessionFile: savedInst.sessionFile,
					turnCount: savedInst.turnCount,
				};

				const key = getInstanceKey(def.name, inst.id);
				instances.set(key, inst);
				restoredCount++;
			}

			if (restoredCount > 0) {
				updateWidgets();
				const runningCount = savedState.instances.filter(i => i.status === "running").length;
				const doneCount = savedState.instances.filter(i => i.status === "done").length;
				const errorCount = savedState.instances.filter(i => i.status === "error").length;
				const parts: string[] = [];
				if (runningCount > 0) parts.push(`${runningCount} running`);
				if (doneCount > 0) parts.push(`${doneCount} done`);
				if (errorCount > 0) parts.push(`${errorCount} error`);
				ctx.ui.notify(
					`Restored ${restoredCount} agent(s) from previous session (${parts.join(", ")}).`,
					runningCount > 0 ? "warning" : "info"
				);
			}
		}

		const allAgents = loadAllAgents();
		const agentList = Array.from(allAgents.values())
			.map(def => `• ${def.name} — ${def.model.split("/").pop()}`)
			.join("\n");

	});

	pi.on("session_switch", async (event, ctx) => {
		if (event.reason === "new") {
			clearAgents(ctx.ui);
			resetSavedState();
		}
	});
}
