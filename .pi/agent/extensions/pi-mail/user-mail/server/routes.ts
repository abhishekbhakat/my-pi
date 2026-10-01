/**
 * Route handlers for the user-mail server (issue #5).
 *
 * Six routes: /hello, /user, /users, /mail, /inbox, /read-ack. All state
 * lives under rootDir: users.json as the registry and inboxes/<mail-id>/ as
 * mail stores.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { badMailboxId, loadRegistry, saveRegistry } from "./registry.ts";
import { readJsonBody, sendJson } from "./http.ts";
import type { RateLimiter } from "./ratelimit.ts";
import { ackMessages, listUnread, unreadChars, writeMessage } from "../mailbox/store.ts";
import { MAX_MAIL_CHARS, parseEnvelope, SERVICE, VERSION } from "../protocol.ts";

export interface RouteDeps {
	/** Storage root, the machine's pi-user-mail dir. */
	rootDir: string;
	/** Mail id of the server machine, reported by /hello. */
	selfId: string;
	/** Per-IP limiter for POST /mail. */
	limiter: RateLimiter;
}

export async function handleRoutes(
	request: IncomingMessage,
	response: ServerResponse,
	deps: RouteDeps,
): Promise<void> {
	const url = new URL(request.url ?? "/", "http://localhost");
	const path = url.pathname.replace(/\/+$/, "");
	const inboxesDir = join(deps.rootDir, "inboxes");

	if (request.method === "GET" && path === "/hello") {
		return sendJson(response, 200, {
			service: SERVICE,
			version: VERSION,
			id: deps.selfId,
			maxChars: MAX_MAIL_CHARS,
		});
	}

	if (request.method === "POST" && path === "/user") {
		const body = await readJsonBody(request);
		const id = typeof body?.id === "string" ? body.id.trim() : "";
		if (!id || badMailboxId(id)) {
			return sendJson(response, 400, { error: "invalid_id" });
		}
		const registry = await loadRegistry(deps.rootDir);
		const now = Date.now();
		const existing = registry[id];
		registry[id] = { registeredAt: existing?.registeredAt ?? now, lastSeenAt: now };
		await saveRegistry(deps.rootDir, registry);
		return sendJson(response, 200, { registered: true, id });
	}

	if (request.method === "GET" && path === "/users") {
		const alias = url.searchParams.get("alias")?.trim() ?? "";
		if (!alias) return sendJson(response, 400, { error: "invalid_alias" });
		const registry = await loadRegistry(deps.rootDir);
		return sendJson(response, 200, {
			ids: Object.keys(registry).filter((id) => id.startsWith(`${alias}@`)),
		});
	}

	if (request.method === "POST" && path === "/mail") {
		const ip = request.socket.remoteAddress ?? "unknown";
		if (!deps.limiter.allow(ip)) {
			return sendJson(response, 429, { error: "rate_limited" });
		}
		const body = await readJsonBody(request);
		const envelope = parseEnvelope(body);
		if (!envelope) {
			return sendJson(response, 400, { error: "invalid_envelope" });
		}
		if (badMailboxId(envelope.to)) {
			return sendJson(response, 400, { error: "invalid_recipient" });
		}
		const registry = await loadRegistry(deps.rootDir);
		if (!registry[envelope.to]) {
			return sendJson(response, 404, { error: "unknown_recipient" });
		}
		const inbox = join(inboxesDir, envelope.to);
		const used = await unreadChars(inbox);
		if (used + envelope.text.length > MAX_MAIL_CHARS) {
			return sendJson(response, 409, { error: "mailbox_full", usedChars: used });
		}
		await writeMessage(inbox, envelope);
		return sendJson(response, 200, { queued: true, id: envelope.id });
	}

	if (request.method === "GET" && path === "/inbox") {
		const id = url.searchParams.get("id")?.trim() ?? "";
		if (!id || badMailboxId(id)) return sendJson(response, 400, { error: "invalid_id" });
		const registry = await loadRegistry(deps.rootDir);
		if (!registry[id]) return sendJson(response, 404, { error: "unknown_recipient" });
		const messages = await listUnread(join(inboxesDir, id));
		return sendJson(response, 200, { messages });
	}

	if (request.method === "POST" && path === "/read-ack") {
		const body = await readJsonBody(request);
		const id = typeof body?.id === "string" ? body.id.trim() : "";
		const ids = Array.isArray(body?.messageIds)
			? body.messageIds.filter((v): v is string => typeof v === "string")
			: [];
		if (!id || badMailboxId(id)) return sendJson(response, 400, { error: "invalid_id" });
		if (ids.length === 0) return sendJson(response, 400, { error: "no_message_ids" });
		const archived = await ackMessages(join(inboxesDir, id), ids);
		return sendJson(response, 200, { archived });
	}

	return sendJson(response, 404, { error: "not_found" });
}
