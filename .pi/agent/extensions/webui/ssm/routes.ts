import type { IncomingMessage, ServerResponse } from "node:http";
import { deleteSessionFile } from "./delete";
import { json, readJson, text } from "../utils/http";
import { archiveSession, unarchiveSession } from "./archive";
import { renderSsmPage } from "./html";
import { findSession, getCatalog, invalidateCatalog } from "./sessions";
import { assertCatalogPath, renderSessionViewHtml } from "./session-view";

export interface SsmLiveInfo {
	path?: string;
	id?: string;
	cwd?: string;
	pid?: number;
}

interface PathBody {
	path?: string;
}

export interface SsmRouteOpts {
	themeName: string;
	lives: SsmLiveInfo[];
	healthExtra?: Record<string, unknown>;
}

function sessionIsLive(path: string, id: string, lives: SsmLiveInfo[]): boolean {
	return lives.some((l) => (l.path && l.path === path) || (l.id && l.id === id));
}

async function catalogPayload(opts: SsmRouteOpts, force = false) {
	const catalog = await getCatalog(force);
	const sessions = catalog.sessions.map((s) => ({
		...s,
		live: sessionIsLive(s.path, s.id, opts.lives),
	}));
	return {
		...catalog,
		sessions,
		liveCount: sessions.filter((s) => s.live).length,
	};
}

/** Catalog + read-only view. Return true if handled. */
export async function handleSsmRoutes(
	request: IncomingMessage,
	response: ServerResponse,
	url: URL,
	opts: SsmRouteOpts,
): Promise<boolean> {
	if (request.method === "GET" && url.pathname === "/ssm") {
		text(response, 200, renderSsmPage(opts.themeName), "text/html; charset=utf-8");
		return true;
	}

	if (request.method === "GET" && url.pathname === "/view") {
		const raw = url.searchParams.get("path")?.trim();
		if (!raw) {
			json(response, 400, { error: "path query required" });
			return true;
		}
		try {
			const sessionPath = await assertCatalogPath(raw);
			text(response, 200, renderSessionViewHtml(sessionPath, opts.themeName), "text/html; charset=utf-8");
		} catch (error) {
			json(response, 404, {
				error: error instanceof Error ? error.message : String(error),
			});
		}
		return true;
	}

	if (request.method === "GET" && url.pathname === "/api/catalog") {
		json(response, 200, await catalogPayload(opts, url.searchParams.get("refresh") === "1"));
		return true;
	}

	if (request.method === "POST" && url.pathname === "/api/invalidate") {
		invalidateCatalog();
		json(response, 200, { ok: true });
		return true;
	}

	if (request.method === "POST" && url.pathname === "/api/refresh") {
		invalidateCatalog();
		json(response, 200, await catalogPayload(opts, true));
		return true;
	}

	if (request.method === "POST" && (url.pathname === "/api/archive" || url.pathname === "/api/unarchive")) {
		const body = await readJson<PathBody>(request);
		const path = body.path?.trim();
		if (!path) {
			json(response, 400, { error: "path is required" });
			return true;
		}
		const catalog = await getCatalog();
		const session = findSession(path, catalog);
		if (!session) {
			json(response, 404, { error: "session not in catalog" });
			return true;
		}
		if (url.pathname === "/api/archive") archiveSession(path, session.id);
		else unarchiveSession(path);
		invalidateCatalog();
		json(response, 200, { ok: true, catalog: await catalogPayload(opts, true) });
		return true;
	}

	if (request.method === "POST" && url.pathname === "/api/delete") {
		const body = await readJson<PathBody>(request);
		const path = body.path?.trim();
		if (!path) {
			json(response, 400, { error: "path is required" });
			return true;
		}
		// Force fresh catalog so terminal deletes are not ghosts.
		const catalog = await getCatalog(true);
		const session = findSession(path, catalog);
		// Allow ghost rows (file already removed) when path still looks like a session file.
		if (!session && !(path.endsWith(".jsonl") && path.includes("/sessions/"))) {
			json(response, 404, { error: "session not in catalog" });
			return true;
		}
		const targetPath = session?.path ?? path;
		const targetId = session?.id ?? "";
		if (sessionIsLive(targetPath, targetId, opts.lives)) {
			json(response, 409, { error: "cannot delete a running session" });
			return true;
		}
		try {
			deleteSessionFile(targetPath);
			unarchiveSession(targetPath);
		} catch (error) {
			json(response, 500, {
				error: error instanceof Error ? error.message : String(error),
			});
			return true;
		}
		invalidateCatalog();
		json(response, 200, {
			ok: true,
			alreadyGone: !session,
			catalog: await catalogPayload(opts, true),
		});
		return true;
	}

	if (request.method === "GET" && url.pathname === "/api/health") {
		json(response, 200, {
			ok: true,
			theme: opts.themeName,
			lives: opts.lives,
			...opts.healthExtra,
		});
		return true;
	}

	return false;
}
