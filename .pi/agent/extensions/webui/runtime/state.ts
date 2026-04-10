import type { WebUiRuntime } from "./types";

export function createWebUiRuntime(): WebUiRuntime {
	return {
		clients: new Map(),
		isStreaming: false,
	};
}
