/**
 * HTTP plumbing for the user-mail server (issue #5). Plain node:http, no
 * Bun APIs: pi loads extensions under Node.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

/** Request bodies stay small: envelope text cap plus JSON overhead. */
export const MAX_BODY_BYTES = 2 * 1024 * 1024;

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
	const payload = JSON.stringify(body) + "\n";
	response.writeHead(status, { "content-type": "application/json", "content-length": payload.length });
	response.end(payload);
}

/** Read a request body as JSON. Null when unparseable or oversized. */
export async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown> | null> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of request) {
		size += chunk.length;
		if (size > MAX_BODY_BYTES) return null;
		chunks.push(chunk as Buffer);
	}
	try {
		const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
		return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}
