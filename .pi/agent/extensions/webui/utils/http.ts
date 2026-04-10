import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export function json(response: ServerResponse, status: number, body: unknown): void {
	response.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
	});
	response.end(JSON.stringify(body));
}

export function text(response: ServerResponse, status: number, body: string, contentType = "text/plain; charset=utf-8"): void {
	response.writeHead(status, {
		"content-type": contentType,
		"cache-control": "no-store",
	});
	response.end(body);
}

export function sendSseHeaders(response: ServerResponse): void {
	response.writeHead(200, {
		"content-type": "text/event-stream; charset=utf-8",
		"cache-control": "no-cache, no-transform",
		connection: "keep-alive",
		"x-accel-buffering": "no",
	});
}

export function writeSse(response: ServerResponse, event: string, data: unknown): void {
	response.write(`event: ${event}\n`);
	response.write(`data: ${JSON.stringify(data)}\n\n`);
}

export async function readJson<T>(request: IncomingMessage): Promise<T> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	const raw = Buffer.concat(chunks).toString("utf8").trim();
	if (!raw) {
		return {} as T;
	}
	return JSON.parse(raw) as T;
}

export function makeClientId(): string {
	return randomUUID();
}
