import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { CustomEntry } from "@mariozechner/pi-coding-agent/dist/core/session-manager.js";
import type { AgentInstance, AgentWidgetState, PersistedAgentInstance } from "./types";

const CUSTOM_TYPE = "agent-widget";
const SAVE_DEBOUNCE_MS = 5000;

let saveTimeout: ReturnType<typeof setTimeout> | null = null;
let lastSavedState = "";

function serializeInstance(inst: AgentInstance): PersistedAgentInstance {
	return {
		id: inst.id,
		defName: inst.def.name,
		status: inst.status,
		task: inst.task,
		textChunks: inst.textChunks,
		toolCount: inst.toolCount,
		elapsed: inst.elapsed,
		sessionFile: inst.sessionFile,
		turnCount: inst.turnCount,
	};
}

export function saveAgentState(
	pi: ExtensionAPI,
	instances: Map<string, AgentInstance>,
	instanceIds: Map<string, number>
): void {
	if (saveTimeout) {
		clearTimeout(saveTimeout);
	}

	saveTimeout = setTimeout(() => {
		const state: AgentWidgetState = {
			instances: Array.from(instances.values()).map(serializeInstance),
			instanceIds: Array.from(instanceIds.entries()),
		};

		const stateStr = JSON.stringify(state);
		if (stateStr !== lastSavedState) {
			pi.appendEntry(CUSTOM_TYPE, state);
			lastSavedState = stateStr;
		}
		saveTimeout = null;
	}, SAVE_DEBOUNCE_MS);
}

export function loadAgentState(ctx: ExtensionContext): AgentWidgetState | null {
	const entries = ctx.sessionManager.getEntries();

	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type === "custom" && (entry as CustomEntry).customType === CUSTOM_TYPE) {
			const data = (entry as CustomEntry<AgentWidgetState>).data;
			if (data && Array.isArray(data.instances)) {
				return data;
			}
		}
	}

	return null;
}

export function resetSavedState(): void {
	lastSavedState = "";
	if (saveTimeout) {
		clearTimeout(saveTimeout);
		saveTimeout = null;
	}
}
