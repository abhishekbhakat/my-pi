/**
 * Wire types and validators for user mail (issue #5).
 *
 * Shared by server and client. Imports nothing beyond node and Bun globals
 * so it stays unit-testable outside pi.
 */

export const SERVICE = "pi-user-mail";
export const VERSION = 1;

/** Fixed TCP port for the mail server (after 3.14). */
export const DEFAULT_TCP_PORT = 15926;
/** Fixed UDP port for discovery broadcasts. */
export const DEFAULT_DISCOVERY_PORT = 15925;

/** Max characters in one mail body, and max total unread text per inbox. */
export const MAX_MAIL_CHARS = 100_000;

/** v1 rate limit: messages per minute per source IP. */
export const RATE_LIMIT_PER_MINUTE = 60;

/** Mail older than the TTL shows a stale flag. PI_USER_MAIL_TTL_MS overrides. */
export const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function getTtlMs(): number {
	const raw = process.env.PI_USER_MAIL_TTL_MS?.trim();
	if (!raw) return DEFAULT_TTL_MS;
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new Error("PI_USER_MAIL_TTL_MS must be a positive integer number of milliseconds");
	}
	return value;
}

export function isStale(sentAt: number, now = Date.now(), ttlMs = getTtlMs()): boolean {
	return now - sentAt > ttlMs;
}

/** Answer of `GET /hello` from a pi-user-mail server. */
export interface HelloResponse {
	service: typeof SERVICE;
	version: number;
	/** Mail id of the machine running the server, for tiebreaks. */
	id: string;
	maxChars: number;
}

/** One message on the wire, same shape in both directions. */
export interface MailEnvelope {
	id: string;
	/** Sender mail id: alias@username. */
	from: string;
	/** Recipient mail id: alias@username. */
	to: string;
	text: string;
	sentAt: number;
}

function readPort(env: string, fallback: number): number {
	const raw = process.env[env]?.trim();
	if (!raw) return fallback;
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value <= 0 || value > 65535) {
		throw new Error(`${env} must be a port between 1 and 65535`);
	}
	return value;
}

export function tcpPort(): number {
	return readPort("PI_USER_MAIL_PORT", DEFAULT_TCP_PORT);
}

export function discoveryPort(): number {
	return readPort("PI_USER_MAIL_DISCOVERY_PORT", DEFAULT_DISCOVERY_PORT);
}

/** Parse a /hello answer. Returns null when the responder is not ours. */
export function parseHello(parsed: unknown): HelloResponse | null {
	if (typeof parsed !== "object" || parsed === null) return null;
	const raw = parsed as Record<string, unknown>;
	if (raw.service !== SERVICE || typeof raw.version !== "number" || typeof raw.id !== "string") {
		return null;
	}
	const maxChars = typeof raw.maxChars === "number" && Number.isSafeInteger(raw.maxChars)
		? raw.maxChars
		: MAX_MAIL_CHARS;
	return { service: SERVICE, version: raw.version, id: raw.id, maxChars };
}

/** Parse a /mail envelope. Returns null on any shape or size violation. */
export function parseEnvelope(parsed: unknown): MailEnvelope | null {
	if (typeof parsed !== "object" || parsed === null) return null;
	const raw = parsed as Record<string, unknown>;
	const { id, from, to, text, sentAt } = raw;
	if (typeof id !== "string" || !id) return null;
	if (typeof from !== "string" || !from) return null;
	if (typeof to !== "string" || !to) return null;
	if (typeof text !== "string" || !text.trim()) return null;
	if (text.length > MAX_MAIL_CHARS) return null;
	if (typeof sentAt !== "number" || !Number.isSafeInteger(sentAt) || sentAt <= 0) return null;
	return { id, from, to, text, sentAt };
}
