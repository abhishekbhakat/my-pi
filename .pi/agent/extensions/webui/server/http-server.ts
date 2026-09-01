import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { routeRequest } from "./routes";
import type { WebUiRuntime } from "../runtime/types";
import { getWebUiRegistryEntry, setWebUiRegistryEntry } from "./registry";

export type WebUiBindContext = ExtensionContext | ExtensionCommandContext;

let exitHooksInstalled = false;

function installExitHooks(runtime: WebUiRuntime): void {
	if (exitHooksInstalled) return;
	exitHooksInstalled = true;
	const close = () => {
		void shutdownWebUiServer(runtime);
	};
	process.once("beforeExit", close);
	process.once("exit", close);
	process.once("SIGINT", close);
	process.once("SIGTERM", close);
}

function bindContext(runtime: WebUiRuntime, ctx: WebUiBindContext, themeName?: string): void {
	runtime.currentContext = ctx;
	runtime.currentSessionManager = ctx.sessionManager;
	runtime.cwd = ctx.cwd;
	runtime.abortCurrent = () => ctx.abort();
	if (themeName) runtime.themeName = themeName;
}

function attachRequestHandler(pi: ExtensionAPI, runtime: WebUiRuntime, server: Server): void {
	server.removeAllListeners("request");
	server.on("request", (request, response) => {
		void routeRequest(pi, runtime, request, response, runtime.themeName).catch((error) => {
			response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
			response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
		});
	});
}

function adoptExisting(pi: ExtensionAPI, runtime: WebUiRuntime): { baseUrl: string; port: number } | undefined {
	const existing = getWebUiRegistryEntry();
	if (!existing?.server.listening || existing.pid !== process.pid) return undefined;
	attachRequestHandler(pi, runtime, existing.server);
	runtime.httpServer = existing.server;
	runtime.port = existing.port;
	runtime.baseUrl = existing.baseUrl;
	existing.shutdown = async () => {
		await shutdownWebUiServer(runtime);
	};
	return { baseUrl: existing.baseUrl, port: existing.port };
}

/**
 * Ephemeral loopback live UI (prompt/abort/SSE). Not 17300 — daemon owns that.
 */
export async function ensureWebUiServer(
	pi: ExtensionAPI,
	runtime: WebUiRuntime,
	ctx: WebUiBindContext,
	themeName?: string,
): Promise<{ baseUrl: string; port: number; reused: boolean }> {
	installExitHooks(runtime);
	bindContext(runtime, ctx, themeName);

	if (runtime.httpServer?.listening && runtime.baseUrl && runtime.port) {
		attachRequestHandler(pi, runtime, runtime.httpServer);
		return { baseUrl: runtime.baseUrl, port: runtime.port, reused: true };
	}

	const adopted = adoptExisting(pi, runtime);
	if (adopted) return { ...adopted, reused: true };

	const leftover = getWebUiRegistryEntry();
	if (leftover) {
		await leftover.shutdown().catch(() => undefined);
		setWebUiRegistryEntry(undefined);
	}

	const server = createServer();
	attachRequestHandler(pi, runtime, server);

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", reject);
			resolve();
		});
	});

	const address = server.address() as AddressInfo;
	const baseUrl = `http://127.0.0.1:${address.port}`;
	runtime.httpServer = server;
	runtime.port = address.port;
	runtime.baseUrl = baseUrl;

	setWebUiRegistryEntry({
		server,
		port: address.port,
		baseUrl,
		pid: process.pid,
		startedAt: new Date().toISOString(),
		shutdown: async () => {
			await shutdownWebUiServer(runtime);
		},
	});

	return { baseUrl, port: address.port, reused: false };
}

export async function shutdownWebUiServer(runtime: WebUiRuntime): Promise<void> {
	for (const client of runtime.clients.values()) {
		client.response.end();
	}
	runtime.clients.clear();

	const server = runtime.httpServer ?? getWebUiRegistryEntry()?.server;
	if (!server) {
		setWebUiRegistryEntry(undefined);
		return;
	}

	await new Promise<void>((resolve) => {
		server.close(() => resolve());
		setTimeout(() => resolve(), 500).unref?.();
	});

	if (getWebUiRegistryEntry()?.server === server) setWebUiRegistryEntry(undefined);
	delete runtime.httpServer;
	delete runtime.baseUrl;
	delete runtime.port;
}
