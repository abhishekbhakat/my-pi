import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { broadcast, broadcastRuntime, broadcastSession } from "../runtime/broadcast";
import { ensureWebUiServer, shutdownWebUiServer } from "../server/http-server";
import { ensureSsmDaemon } from "../ssm/ensure-daemon";
import { registerLive, unregisterLive } from "../ssm/live-client";
import type { WebUiRuntime } from "../runtime/types";

function themeFor(cwd: string): string | undefined {
	try {
		return SettingsManager.create(cwd).getTheme();
	} catch {
		return undefined;
	}
}

const HEARTBEAT_MS = 10_000;
let heartbeat: ReturnType<typeof setInterval> | undefined;

async function attachLive(
	pi: ExtensionAPI,
	runtime: WebUiRuntime,
	ctx: ExtensionContext,
	theme?: string,
): Promise<void> {
	await ensureSsmDaemon();
	const { port } = await ensureWebUiServer(pi, runtime, ctx, theme);
	const payload = {
		port,
		pid: process.pid,
		id: ctx.sessionManager.getSessionId(),
		path: ctx.sessionManager.getSessionFile(),
		cwd: ctx.cwd,
	};
	const ok = await registerLive(payload);
	if (!ok) throw new Error("could not register this pi with ssm-daemon");
	if (heartbeat) clearInterval(heartbeat);
	heartbeat = setInterval(() => {
		void registerLive({
			...payload,
			id: ctx.sessionManager.getSessionId(),
			path: ctx.sessionManager.getSessionFile(),
			cwd: ctx.cwd,
			port: runtime.port ?? payload.port,
		}).catch(() => undefined);
	}, HEARTBEAT_MS);
	heartbeat.unref?.();
}

export function registerSessionEvents(pi: ExtensionAPI, runtime: WebUiRuntime): void {
	pi.on("session_start", async (_event, ctx) => {
		runtime.currentContext = ctx;
		runtime.currentSessionManager = ctx.sessionManager;
		runtime.cwd = ctx.cwd;
		runtime.abortCurrent = () => ctx.abort();
		const theme = themeFor(ctx.cwd);
		if (theme) runtime.themeName = theme;
		broadcastSession(pi, runtime, ctx);

		try {
			await attachLive(pi, runtime, ctx, theme);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			ctx.ui.notify(`SSM daemon: ${message}`, "warning");
		}
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

	pi.on("session_shutdown", async (event) => {
		const keep = event.reason === "new" || event.reason === "resume" || event.reason === "fork";
		if (keep) return;
		if (heartbeat) {
			clearInterval(heartbeat);
			heartbeat = undefined;
		}
		await unregisterLive(process.pid);
		await shutdownWebUiServer(runtime);
	});
}
