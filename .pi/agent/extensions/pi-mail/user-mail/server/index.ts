/**
 * The one server per network (issue #5): entry point.
 *
 * node:http server over the routes in routes.ts. Loaded only by the machine
 * that wins the election; election.ts lazy-imports this module so client
 * sessions never parse server code.
 */

import { createServer, type Server } from "node:http";
import { mkdir } from "node:fs/promises";
import { sendJson } from "./http.ts";
import { handleRoutes } from "./routes.ts";
import { RateLimiter } from "./ratelimit.ts";

export interface ServerOptions {
	/** 0 lets the OS pick; tests use it. */
	port: number;
	/** Bind address. Default 0.0.0.0 so LAN peers can reach us. */
	hostname?: string;
	/** Storage root, the machine's pi-user-mail dir. */
	rootDir: string;
	/** Mail id of the server machine, reported by /hello. */
	selfId: string;
}

export interface RunningServer {
	port: number;
	stop(): Promise<void>;
}

export async function startServer(options: ServerOptions): Promise<RunningServer> {
	await mkdir(options.rootDir, { recursive: true, mode: 0o700 });
	const limiter = new RateLimiter();

	const httpServer: Server = createServer((request, response) => {
		void handleRoutes(request, response, {
			rootDir: options.rootDir,
			selfId: options.selfId,
			limiter,
		}).catch(() => {
			if (!response.headersSent) sendJson(response, 500, { error: "internal" });
			else response.end();
		});
	});

	await new Promise<void>((resolve, reject) => {
		httpServer.once("error", reject);
		httpServer.listen(options.port, options.hostname ?? "0.0.0.0", () => {
			httpServer.removeListener("error", reject);
			resolve();
		});
	});

	const address = httpServer.address();
	if (address === null || typeof address === "string") {
		await new Promise<void>((resolve) => httpServer.close(() => resolve()));
		throw new Error("server bound to an unexpected socket type");
	}

	return {
		port: address.port,
		stop(): Promise<void> {
			return new Promise((resolve) => {
				httpServer.close(() => resolve());
			});
		},
	};
}
