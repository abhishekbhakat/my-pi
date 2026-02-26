import type { AgentDef } from "./agents";
import type { AgentInstance, SpawnCallbacks, SpawnOptions } from "./types";
import { instances, instanceIds, getNextInstanceId } from "./runtime";
import { getInstanceKey, makeSessionFile, spawnAgentInstance } from "./instance";
import { updateWidgets, scheduleWidgetUpdate } from "./widget-updater";
import { saveAgentState } from "./persistence";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// Reference to ExtensionAPI for saving state
let piRef: ExtensionAPI | null = null;

export function setPersistenceApi(pi: ExtensionAPI): void {
	piRef = pi;
}

function triggerSave(): void {
	if (piRef) {
		saveAgentState(piRef, instances, instanceIds);
	}
}

export function createInstance(def: AgentDef, task: string): AgentInstance {
	const currentId = getNextInstanceId(def.name);

	return {
		id: currentId,
		def,
		status: "running",
		task,
		textChunks: [],
		toolCount: 0,
		elapsed: 0,
		sessionFile: makeSessionFile(def.name, currentId),
		turnCount: 1,
	};
}

export function storeInstance(inst: AgentInstance): void {
	const key = getInstanceKey(inst.def.name, inst.id);
	instances.set(key, inst);
	updateWidgets();
	triggerSave();
}

export function makeCallbacks(): SpawnCallbacks {
	return {
		onTextDelta: () => scheduleWidgetUpdate(),
		onToolStart: () => scheduleWidgetUpdate(),
		onStatusChange: () => {
			updateWidgets();
			triggerSave();
		},
	};
}

export async function spawnSingle(
	def: AgentDef,
	task: string,
	signal?: AbortSignal
): Promise<{ inst: AgentInstance; result: string }> {
	const inst = createInstance(def, task);
	storeInstance(inst);

	const callbacks = makeCallbacks();
	const result = await spawnAgentInstance(inst, task, callbacks, { signal });

	// Save final state
	triggerSave();

	return { inst, result };
}

export async function spawnParallel(
	defs: AgentDef[],
	task: string,
	signal?: AbortSignal
): Promise<{ insts: AgentInstance[]; results: string[] }> {
	const insts: AgentInstance[] = [];
	for (const def of defs) {
		const inst = createInstance(def, task);
		storeInstance(inst);
		insts.push(inst);
	}

	const callbacks = makeCallbacks();

	// Stagger starts by 150ms to avoid lock file conflicts, then run in parallel
	const promises = insts.map((inst, i) =>
		new Promise<string>((resolve) => {
			setTimeout(() => {
				spawnAgentInstance(inst, task, callbacks, { signal }).then(resolve);
			}, i * 150);
		})
	);

	const results = await Promise.all(promises);

	// Save final state
	triggerSave();

	return { insts, results };
}

export async function continueInstance(
	agentName: string,
	id: number,
	prompt: string,
	signal?: AbortSignal
): Promise<{ inst: AgentInstance; result: string } | null> {
	const key = getInstanceKey(agentName, id);
	const inst = instances.get(key);

	if (!inst || inst.status === "running") {
		return null;
	}

	inst.status = "running";
	inst.task = prompt;
	inst.textChunks = [];
	inst.elapsed = 0;
	inst.turnCount++;
	updateWidgets();
	triggerSave();

	const callbacks = makeCallbacks();
	const result = await spawnAgentInstance(inst, prompt, callbacks, { signal });

	// Save final state
	triggerSave();

	return { inst, result };
}

export function removeInstance(agentName: string, id: number): AgentInstance | null {
	const key = getInstanceKey(agentName, id);
	const inst = instances.get(key);

	if (!inst) return null;

	if (inst.proc && inst.status === "running") {
		inst.proc.kill("SIGTERM");
	}

	instances.delete(key);
	updateWidgets();
	triggerSave();
	return inst;
}

export function clearAll(): { count: number; killed: number } {
	let killed = 0;
	for (const [_key, inst] of instances) {
		if (inst.proc && inst.status === "running") {
			inst.proc.kill("SIGTERM");
			killed++;
		}
	}

	const count = instances.size;
	instances.clear();
	triggerSave();
	return { count, killed };
}

export function listActiveInstances(): AgentInstance[] {
	return Array.from(instances.values()).sort((a, b) => {
		const typeOrder = ["scout", "coder", "reviewer", "youtrack"].indexOf(a.def.name.toLowerCase())
			- ["scout", "coder", "reviewer", "youtrack"].indexOf(b.def.name.toLowerCase());
		if (typeOrder !== 0) return typeOrder;
		return a.id - b.id;
	});
}
