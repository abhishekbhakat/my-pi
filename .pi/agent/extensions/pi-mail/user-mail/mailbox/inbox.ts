/**
 * Inbox action for user mail (issue #5). Syncs the local mirror from the
 * server, then lists unread headers.
 */

import { registerUser, type ServerEndpoint } from "../client.ts";
import { listUnread } from "./store.ts";
import { isStale } from "../protocol.ts";
import { flushPendingAcks, mirrorDir, pull } from "./sync.ts";
import { clampLimit, formatAge, headerLine } from "../session/format.ts";

export interface InboxOutcome {
	text: string;
	details: Record<string, unknown>;
}

export async function performInbox(
	endpoint: ServerEndpoint,
	rootDir: string,
	myId: string,
	limit: number | undefined,
): Promise<InboxOutcome> {
	await registerUser(endpoint, myId);
	await flushPendingAcks(endpoint, myId, rootDir).catch(() => {});
	const added = await pull(endpoint, myId, rootDir);
	const messages = await listUnread(mirrorDir(rootDir));
	if (messages.length === 0) {
		return { text: "Inbox empty.", details: { unread: 0, added } };
	}
	const stale = messages.filter((m) => isStale(m.sentAt)).length;
	const lines = messages.slice(0, clampLimit(limit, 20)).map(headerLine);
	return {
		text:
			`${messages.length} unread${stale ? ` (${stale} stale)` : ""}, ${added} new this sync. ` +
			`Use user_mail read to inject bodies into your leaf.\n${lines.join("\n")}`,
		details: { unread: messages.length, added, stale },
	};
}

/** Sync prep shared by inbox and read: register, flush acks, pull mirror. */
export async function syncPrep(
	endpoint: ServerEndpoint,
	rootDir: string,
	myId: string,
): Promise<number> {
	await registerUser(endpoint, myId);
	await flushPendingAcks(endpoint, myId, rootDir).catch(() => {});
	return pull(endpoint, myId, rootDir);
}

export { formatAge };
