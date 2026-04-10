import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { buildSessionData } from "../core/session-data";
import type { WebUiRuntime } from "./types";
import { writeSse } from "../utils/http";

function runtimeSnapshot(ctx?: ExtensionContext, runtime?: WebUiRuntime) {
	const sessionManager = ctx?.sessionManager ?? runtime?.currentSessionManager;
	return {
		isStreaming: runtime?.isStreaming ?? false,
		sessionFile: sessionManager?.getSessionFile(),
		sessionId: sessionManager?.getSessionId(),
		sessionName: sessionManager?.getSessionName(),
		model: runtime?.currentModel,
	};
}

export function broadcast(runtime: WebUiRuntime, event: string, payload: unknown): void {
	for (const client of runtime.clients.values()) {
		writeSse(client.response, event, payload);
	}
}

export function broadcastRuntime(runtime: WebUiRuntime, ctx?: ExtensionContext): void {
	broadcast(runtime, "runtime", runtimeSnapshot(ctx, runtime));
}

export function broadcastSession(pi: ExtensionAPI, runtime: WebUiRuntime, ctx: ExtensionContext): void {
	broadcast(runtime, "session", {
		sessionData: buildSessionData(pi, ctx, runtime),
		runtime: runtimeSnapshot(ctx, runtime),
	});
}

export function sendSnapshot(pi: ExtensionAPI, runtime: WebUiRuntime, ctx: ExtensionContext, clientId: string): void {
	const client = runtime.clients.get(clientId);
	if (!client) return;
	writeSse(client.response, "snapshot", {
		sessionData: buildSessionData(pi, ctx, runtime),
		runtime: runtimeSnapshot(ctx, runtime),
	});
}
