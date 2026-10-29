/**
 * Detached SSM daemon. Owns 127.0.0.1:17300.
 * Catalog/view from disk. Live / and /__webui/* proxied to a registered pi.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { writeFileSync, unlinkSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { json, readJson, text } from "../utils/http";
import { SSM_DAEMON_KIND, SSM_DAEMON_VERSION, SSM_PORT } from "./constants";
import { proxyToLive, renderNoLivePage } from "./proxy";
import { canonicalLiveUrl, selectLiveBackend } from "./live-routing";
import { readProcessInfo } from "./process-info";
import { handleSsmRoutes, type SsmLiveInfo } from "./routes";

export interface LiveBackend {
	port: number;
	pid: number;
	id?: string;
	path?: string;
	cwd?: string;
	startedAt?: number;
	parentPid?: number;
}

const PIDFILE = join(homedir(), ".pi", "agent", "ssm-server.pid");

/** One entry per live pi process (keyed by pid). */
const lives = new Map<number, LiveBackend>();

function themeName(): string {
	try {
		return SettingsManager.create(homedir()).getTheme();
	} catch {
		return "dark";
	}
}

function pidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function pruneDead(): void {
	for (const pid of [...lives.keys()]) {
		if (!pidAlive(pid)) lives.delete(pid);
	}
}

function liveList(): SsmLiveInfo[] {
	pruneDead();
	return [...lives.values()];
}

function writePid(): void {
	writeFileSync(PIDFILE, `${process.pid}\n`, "utf8");
}

function clearPid(): void {
	try {
		unlinkSync(PIDFILE);
	} catch {
		// ignore
	}
}

async function handleLiveApi(
	request: IncomingMessage,
	response: ServerResponse,
	url: URL,
): Promise<boolean> {
	if (request.method === "POST" && url.pathname === "/api/live") {
		const body = await readJson<Partial<LiveBackend>>(request);
		const port = Number(body.port);
		const pid = Number(body.pid);
		if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(pid) || pid < 1) {
			json(response, 400, { error: "port and pid required" });
			return true;
		}
		const previous = lives.get(pid);
		const info = previous?.port === port ? previous : readProcessInfo(pid);
		lives.set(pid, {
			startedAt: info.startedAt ?? (typeof body.startedAt === "number" && Number.isFinite(body.startedAt) ? body.startedAt : undefined),
			parentPid: info.parentPid ?? (Number.isSafeInteger(body.parentPid) ? body.parentPid : undefined),
			port,
			pid,
			id: typeof body.id === "string" ? body.id : undefined,
			path: typeof body.path === "string" ? body.path : undefined,
			cwd: typeof body.cwd === "string" ? body.cwd : undefined,
		});
		json(response, 200, { ok: true, lives: liveList() });
		return true;
	}

	if (request.method === "DELETE" && url.pathname === "/api/live") {
		const body = await readJson<{ pid?: number }>(request);
		if (body.pid) lives.delete(body.pid);
		json(response, 200, { ok: true, lives: liveList() });
		return true;
	}

	return false;
}

function pickLive(url: URL): LiveBackend | undefined {
	pruneDead();
	return selectLiveBackend(lives.values(), url.searchParams.get("id"), url.searchParams.get("pid"));
}

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
	const url = new URL(request.url ?? "/", `http://127.0.0.1:${SSM_PORT}`);

	if (await handleLiveApi(request, response, url)) return;

	const ssmHandled = await handleSsmRoutes(request, response, url, {
		themeName: themeName(),
		lives: liveList(),
		healthExtra: {
			kind: SSM_DAEMON_KIND,
			version: SSM_DAEMON_VERSION,
			pid: process.pid,
			port: SSM_PORT,
		},
	});
	if (ssmHandled) return;

	const isLivePath =
		url.pathname === "/" || url.pathname === "/live" || url.pathname.startsWith("/__webui/");
	if (isLivePath) {
		const target = pickLive(url);
		if (!target) {
			if (url.pathname.startsWith("/__webui/")) {
				json(response, 409, { error: "live process unavailable; reopen from /ssm" });
			} else {
				text(response, 404, renderNoLivePage(), "text/html; charset=utf-8");
			}
			return;
		}
		if (request.method === "GET" && !url.searchParams.has("pid") && (url.pathname === "/live" || url.pathname === "/")) {
			response.writeHead(302, { location: canonicalLiveUrl(url, target), "cache-control": "no-store" });
			response.end();
			return;
		}
		const backendPath =
			url.pathname === "/live" || url.pathname === "/" ? `/${url.search}` : (request.url ?? "/");
		proxyToLive(
			request,
			response,
			target.port,
			() => {
				lives.delete(target.pid);
			},
			{ path: backendPath },
		);
		return;
	}

	json(response, 404, { error: "not_found" });
}

function start(): void {
	const server = createServer((request, response) => {
		void route(request, response).catch((error) => {
			json(response, 500, { error: error instanceof Error ? error.message : String(error) });
		});
	});

	server.on("error", (error: NodeJS.ErrnoException) => {
		console.error(`ssm-server: ${error.code ?? error.message}`);
		process.exit(1);
	});

	server.listen(SSM_PORT, "127.0.0.1", () => {
		writePid();
		console.log(`ssm-server ${SSM_DAEMON_VERSION} http://127.0.0.1:${SSM_PORT}/ssm pid ${process.pid}`);
	});

	const stop = () => {
		clearPid();
		server.close(() => process.exit(0));
		// Not unref'd: open proxied streams (EventSource) would otherwise keep the
		// process alive and hold port 17300, so the next spawn dies EADDRINUSE.
		setTimeout(() => {
			server.closeAllConnections?.();
			process.exit(0);
		}, 250);
	};
	process.on("SIGTERM", stop);
	process.on("SIGINT", stop);
}

start();
