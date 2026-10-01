/**
 * HTTP client for the user-mail server (issue #5).
 *
 * Every call takes an explicit endpoint and a timeout. Calls throw on
 * transport failure; server-side rejections arrive as Error with the
 * server's error code in the message.
 */

import {
	parseEnvelope,
	parseHello,
	type HelloResponse,
	type MailEnvelope,
} from "./protocol.ts";

export interface ServerEndpoint {
	host: string;
	port: number;
}

function url(endpoint: ServerEndpoint, path: string): string {
	return `http://${endpoint.host}:${endpoint.port}${path}`;
}

async function request(
	endpoint: ServerEndpoint,
	path: string,
	init: RequestInit,
	timeoutMs: number,
): Promise<{ status: number; body: Record<string, unknown> | null }> {
	const response = await fetch(url(endpoint, path), {
		...init,
		signal: AbortSignal.timeout(timeoutMs),
	});
	let body: Record<string, unknown> | null = null;
	try {
		const parsed: unknown = await response.json();
		if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
			body = parsed as Record<string, unknown>;
		}
	} catch {
		// Empty or non-JSON body stays null.
	}
	return { status: response.status, body };
}

function fail(action: string, status: number, body: Record<string, unknown> | null): never {
	const code = typeof body?.error === "string" ? body.error : `http_${status}`;
	throw new Error(`user-mail ${action} failed: ${code}`);
}

/** Probe one endpoint. Null when nothing answers or the responder is foreign. */
export async function hello(endpoint: ServerEndpoint, timeoutMs = 500): Promise<HelloResponse | null> {
	try {
		const { status, body } = await request(endpoint, "/hello", { method: "GET" }, timeoutMs);
		if (status !== 200) return null;
		return parseHello(body);
	} catch {
		return null;
	}
}

/** Register a mail id with the server. */
export async function registerUser(endpoint: ServerEndpoint, id: string, timeoutMs = 2000): Promise<void> {
	const { status, body } = await request(
		endpoint,
		"/user",
		{ method: "POST", body: JSON.stringify({ id }) },
		timeoutMs,
	);
	if (status !== 200) fail("register", status, body);
}

/** Resolve a bare alias to full mail ids known to the server. */
export async function resolveAlias(
	endpoint: ServerEndpoint,
	alias: string,
	timeoutMs = 2000,
): Promise<string[]> {
	const { status, body } = await request(
		endpoint,
		`/users?alias=${encodeURIComponent(alias)}`,
		{ method: "GET" },
		timeoutMs,
	);
	if (status !== 200) fail("resolve-alias", status, body);
	return Array.isArray(body?.ids) ? body.ids.filter((v): v is string => typeof v === "string") : [];
}

/** Send one envelope. Throws with the server's error code on rejection. */
export async function sendMail(
	endpoint: ServerEndpoint,
	envelope: MailEnvelope,
	timeoutMs = 5000,
): Promise<void> {
	const { status, body } = await request(
		endpoint,
		"/mail",
		{ method: "POST", body: JSON.stringify(envelope) },
		timeoutMs,
	);
	if (status !== 200) fail("send", status, body);
}

/** Pull all unread messages for a mail id. */
export async function fetchInbox(
	endpoint: ServerEndpoint,
	id: string,
	timeoutMs = 5000,
): Promise<MailEnvelope[]> {
	const { status, body } = await request(
		endpoint,
		`/inbox?id=${encodeURIComponent(id)}`,
		{ method: "GET" },
		timeoutMs,
	);
	if (status !== 200) fail("fetch-inbox", status, body);
	if (!Array.isArray(body?.messages)) return [];
	return body.messages
		.map((m) => parseEnvelope(m))
		.filter((m): m is MailEnvelope => m !== null);
}

/** Archive messages server-side after a successful local read. */
export async function readAck(
	endpoint: ServerEndpoint,
	id: string,
	messageIds: string[],
	timeoutMs = 5000,
): Promise<void> {
	const { status, body } = await request(
		endpoint,
		"/read-ack",
		{ method: "POST", body: JSON.stringify({ id, messageIds }) },
		timeoutMs,
	);
	if (status !== 200) fail("read-ack", status, body);
}
