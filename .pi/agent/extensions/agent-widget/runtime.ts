import type { AgentInstance } from "./types";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export const instances = new Map<string, AgentInstance>();
export const instanceIds = new Map<string, number>();

export const widgetCtx = {
	value: null as { ui: ExtensionAPI["ui"] } | null,
};

export const throttleState = {
	timer: null as ReturnType<typeof setTimeout> | null,
};

// Tool gate: tracks if agent_list has been called before spawn
export const spawnGate = {
	checked: false,
};

export function getNextInstanceId(agentName: string): number {
	const currentId = instanceIds.get(agentName) || 1;
	instanceIds.set(agentName, currentId + 1);
	return currentId;
}

export function restoreInstanceIds(savedIds: [string, number][]): void {
	for (const [name, id] of savedIds) {
		const currentId = instanceIds.get(name) || 1;
		// Use the higher of saved or current to avoid ID collisions
		instanceIds.set(name, Math.max(id, currentId));
	}
}

export function clearRuntimeState(): void {
	instances.clear();
	instanceIds.clear();
	spawnGate.checked = false;
}
