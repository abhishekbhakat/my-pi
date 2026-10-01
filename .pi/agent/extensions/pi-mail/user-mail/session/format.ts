/**
 * Display helpers for user mail (issue #5): ages, header lines, limits.
 */

import { isStale } from "../protocol.ts";
import type { MailEnvelope } from "../protocol.ts";

export const MAX_LIST_LIMIT = 50;

export function formatAge(sentAt: number): string {
	const mins = Math.max(0, Math.round((Date.now() - sentAt) / 60000));
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.floor(hours / 24)}d ago`;
}

export function clampLimit(raw: number | undefined, fallback: number): number {
	const n = raw ?? fallback;
	if (!Number.isFinite(n) || n < 1) return fallback;
	return Math.min(Math.floor(n), MAX_LIST_LIMIT);
}

/** One header line for an inbox listing. */
export function headerLine(message: MailEnvelope): string {
	const stale = isStale(message.sentAt) ? ", STALE" : "";
	return `• ${message.id.slice(0, 8)} from ${message.from} (${formatAge(message.sentAt)}${stale})`;
}
