import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { broadcast, broadcastRuntime, broadcastSession } from "../runtime/broadcast";
import { shutdownWebUiServer } from "../server/http-server";
import type { WebUiRuntime } from "../runtime/types";

export function registerSessionEvents(pi: ExtensionAPI, runtime: WebUiRuntime): void {
	pi.on("session_start", async (_event, ctx) => {
		runtime.currentContext = ctx;
		runtime.currentSessionManager = ctx.sessionManager;
		runtime.cwd = ctx.cwd;
		runtime.abortCurrent = () => ctx.abort();
		broadcastSession(pi, runtime, ctx);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		runtime.currentContext = ctx;
		runtime.currentSessionManager = ctx.sessionManager;
		runtime.currentSystemPrompt = event.systemPrompt;
		runtime.currentModel = ctx.model
			? { provider: ctx.model.provider, id: ctx.model.id, name: ctx.model.name }
			: undefined;
		runtime.abortCurrent = () => ctx.abort();
		broadcastRuntime(runtime, ctx);
	});

	pi.on("agent_start", async (_event, ctx) => {
		runtime.currentContext = ctx;
		runtime.currentSessionManager = ctx.sessionManager;
		runtime.isStreaming = true;
		runtime.abortCurrent = () => ctx.abort();
		broadcast(runtime, "agent", { state: "start" });
		broadcastRuntime(runtime, ctx);
	});

	pi.on("agent_end", async (_event, ctx) => {
		runtime.currentContext = ctx;
		runtime.currentSessionManager = ctx.sessionManager;
		runtime.isStreaming = false;
		broadcast(runtime, "agent", { state: "end" });
		broadcastSession(pi, runtime, ctx);
	});

	pi.on("message_end", async (event, ctx) => {
		runtime.currentContext = ctx;
		runtime.currentSessionManager = ctx.sessionManager;
		broadcast(runtime, "message", {
			role: event.message.role,
			timestamp: event.message.timestamp,
		});
		broadcastRuntime(runtime, ctx);
	});

	pi.on("tool_execution_end", async (event, ctx) => {
		runtime.currentContext = ctx;
		runtime.currentSessionManager = ctx.sessionManager;
		broadcast(runtime, "tool", {
			toolName: event.toolName,
			toolCallId: event.toolCallId,
			isError: event.isError,
		});
		broadcastRuntime(runtime, ctx);
	});

	pi.on("model_select", async (event, ctx) => {
		runtime.currentContext = ctx;
		runtime.currentSessionManager = ctx.sessionManager;
		runtime.currentModel = {
			provider: event.model.provider,
			id: event.model.id,
			name: event.model.name,
		};
		broadcastRuntime(runtime, ctx);
	});

	pi.on("session_shutdown", async () => {
		await shutdownWebUiServer(runtime);
	});
}
