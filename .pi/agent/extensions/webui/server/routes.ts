import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { IncomingMessage, ServerResponse } from "node:http";
import { buildEntryDelta, buildSessionData } from "../core/session-data";
import { renderWebUiPage } from "../core/page";
import type { WebUiRuntime } from "../runtime/types";
import { broadcastRuntime, sendSnapshot } from "../runtime/broadcast";
import { json, makeClientId, readJson, sendSseHeaders, text } from "../utils/http";
import { handleModelSettings } from "./model-controls";
import { getLiveAsset } from "../core/assets";

interface PromptRequestBody {
	message?: string;
	deliverAs?: "steer" | "followUp";
}

function getContext(runtime: WebUiRuntime): ExtensionContext | ExtensionCommandContext | undefined {
	return runtime.currentContext;
}

function runtimeResponse(runtime: WebUiRuntime) {
	try {
		const sessionManager = runtime.currentSessionManager;
		return {
			isStreaming: runtime.isStreaming,
			sessionFile: sessionManager?.getSessionFile(),
			sessionId: sessionManager?.getSessionId(),
			sessionName: sessionManager?.getSessionName(),
			model: runtime.currentModel,
		};
	} catch {
		return {
			isStreaming: runtime.isStreaming,
			sessionFile: undefined,
			sessionId: undefined,
			sessionName: undefined,
			model: runtime.currentModel,
		};
	}
}

/** Live-only routes. Catalog lives on the SSM daemon (17300). */
export async function routeRequest(
	pi: ExtensionAPI,
	runtime: WebUiRuntime,
	request: IncomingMessage,
	response: ServerResponse,
	themeName?: string,
): Promise<void> {
	const url = new URL(request.url ?? "/", "http://127.0.0.1");
	if (themeName) runtime.themeName = themeName;

	const ctx = getContext(runtime);
	if (!ctx) {
		json(response, 503, { error: "webui is waiting for a live pi session context" });
		return;
	}

	const matchesSession = () => {
		const identity = url.searchParams.get("id");
		const manager = runtime.currentSessionManager;
		return !!identity && !!manager &&
			(!url.searchParams.has("pid") || url.searchParams.get("pid") === String(process.pid)) &&
			(identity === manager.getSessionId() || identity === manager.getSessionFile());
	};
	if (!matchesSession()) {
		json(response, 409, { error: "session no longer live here; reopen from /ssm" });
		return;
	}

	if (request.method === "GET" && url.pathname.startsWith("/__webui/assets/")) {
		const asset = getLiveAsset(url.pathname);
		if (!asset) {
			json(response, 404, { error: "asset version unavailable; reopen /webui" });
			return;
		}
		response.writeHead(200, {
			"content-type": asset.contentType,
			"cache-control": "private, max-age=31536000, immutable",
			"x-content-type-options": "nosniff",
		});
		response.end(asset.body);
		return;
	}

	const theme = runtime.themeName ?? themeName;

	const withLiveCtx = <T>(fn: (live: ExtensionContext | ExtensionCommandContext) => T): T | undefined => {
		try {
			return fn(ctx);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (message.includes("stale after session")) {
				json(response, 503, { error: "session context is being replaced" });
				return undefined;
			}
			throw error;
		}
	};

	if (request.method === "GET" && url.pathname === "/") {
		const html = withLiveCtx((live) => renderWebUiPage(buildSessionData(pi, live, runtime), theme));
		if (html === undefined) return;
		text(response, 200, html, "text/html; charset=utf-8");
		return;
	}

	if (request.method === "GET" && url.pathname === "/__webui/api/session") {
		const body = withLiveCtx((live) => ({
			sessionData: buildSessionData(pi, live, runtime),
			runtime: runtimeResponse(runtime),
		}));
		if (body === undefined) return;
		json(response, 200, body);
		return;
	}

	if (request.method === "GET" && url.pathname === "/__webui/api/entries") {
		const delta = buildEntryDelta(ctx.sessionManager, {
			sessionId: url.searchParams.get("sessionId"),
			count: url.searchParams.has("count") ? Number(url.searchParams.get("count")) : -1,
			lastId: url.searchParams.get("lastId"),
		});
		json(response, 200, delta);
		return;
	}

	if (url.pathname === "/__webui/api/settings") {
		await handleModelSettings(pi, ctx, request, response, matchesSession);
		return;
	}

	if (request.method === "GET" && url.pathname === "/__webui/events") {
		const clientId = makeClientId();
		sendSseHeaders(response);
		response.write(": connected\n\n");
		runtime.clients.set(clientId, { id: clientId, response });
		withLiveCtx((live) => {
			sendSnapshot(pi, runtime, live, clientId);
		});
		request.on("close", () => {
			runtime.clients.delete(clientId);
		});
		return;
	}

	if (request.method === "POST" && url.pathname === "/__webui/api/prompt") {
		const body = await readJson<PromptRequestBody>(request);
		if (!matchesSession()) {
			json(response, 409, { error: "session changed while reading prompt" });
			return;
		}
		const message = body.message?.trim();
		if (!message) {
			json(response, 400, { error: "message is required" });
			return;
		}
		const deliverAs = body.deliverAs ?? (runtime.isStreaming ? "followUp" : undefined);
		pi.sendUserMessage(message, deliverAs ? { deliverAs } : undefined);
		json(response, 200, { ok: true });
		return;
	}

	if (request.method === "POST" && url.pathname === "/__webui/api/abort") {
		runtime.abortCurrent?.();
		broadcastRuntime(runtime);
		json(response, 200, { ok: true });
		return;
	}

	if (request.method === "GET" && url.pathname === "/__webui/health") {
		json(response, 200, { ok: true, runtime: runtimeResponse(runtime) });
		return;
	}

	json(response, 404, { error: "not_found" });
}
