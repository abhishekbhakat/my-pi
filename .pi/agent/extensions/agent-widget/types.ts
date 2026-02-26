import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { AgentDef } from "./agents";

export type AgentStatus = "running" | "done" | "error";

export interface AgentInstance {
	id: number;
	def: AgentDef;
	status: AgentStatus;
	task: string;
	textChunks: string[];
	toolCount: number;
	elapsed: number;
	sessionFile: string;
	turnCount: number;
	proc?: ChildProcessWithoutNullStreams;
}

/** Serializable subset of AgentInstance for persistence (no proc) */
export interface PersistedAgentInstance {
	id: number;
	defName: string;
	status: AgentStatus;
	task: string;
	textChunks: string[];
	toolCount: number;
	elapsed: number;
	sessionFile: string;
	turnCount: number;
}

/** Data structure saved to session entries */
export interface AgentWidgetState {
	instances: PersistedAgentInstance[];
	instanceIds: [string, number][];
}

export interface WidgetContext {
	ui: ExtensionAPI["ui"];
}

export interface SpawnOptions {
	sendFollowUp?: boolean;
	signal?: AbortSignal;
}

export interface SpawnCallbacks {
	onTextDelta: (chunk: string) => void;
	onToolStart: () => void;
	onStatusChange: (status: AgentStatus, elapsed: number) => void;
}

export interface ActionFailure {
	ok: false;
	error: string;
	level?: "error" | "warning" | "info";
}

export interface ActionSuccess<T> {
	ok: true;
	data: T;
}

export type ActionResult<T> = ActionSuccess<T> | ActionFailure;
