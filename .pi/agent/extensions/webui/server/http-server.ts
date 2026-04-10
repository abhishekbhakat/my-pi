import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { routeRequest } from "./routes";
import type { WebUiRuntime } from "../runtime/types";

export async function ensureWebUiServer(
	pi: ExtensionAPI,
	runtime: WebUiRuntime,
	ctx: ExtensionCommandContext,
	themeName?: string,
): Promise<string> {
	runtime.currentContext = ctx;
	runtime.currentSessionManager = ctx.sessionManager;
	runtime.cwd = ctx.cwd;
	runtime.abortCurrent = () => ctx.abort();

	if (runtime.httpServer && runtime.baseUrl) {
		return runtime.baseUrl;
	}

	const server = createServer((request, response) => {
		void routeRequest(pi, runtime, request, response, themeName).catch((error) => {
			response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
			response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
		});
	});

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", reject);
			resolve();
		});
	});

	const address = server.address() as AddressInfo;
	runtime.httpServer = server;
	runtime.port = address.port;
	runtime.baseUrl = `http://127.0.0.1:${address.port}`;
	return runtime.baseUrl;
}

export async function shutdownWebUiServer(runtime: WebUiRuntime): Promise<void> {
	for (const client of runtime.clients.values()) {
		client.response.end();
	}
	runtime.clients.clear();

	if (!runtime.httpServer) return;
	await new Promise<void>((resolve, reject) => {
		runtime.httpServer?.close((error) => {
			if (error) reject(error);
			else resolve();
		});
	});
	delete runtime.httpServer;
	delete runtime.baseUrl;
	delete runtime.port;
}
