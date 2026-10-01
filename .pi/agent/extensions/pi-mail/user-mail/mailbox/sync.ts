/**
 * Client-side sync for user mail (issue #5).
 *
 * Pull unread messages from the server into the local mirror inbox/, then
 * read offline exactly like session mail. Acks that fail to reach the
 * server land in pending-acks.json and flush on the next pull, so read
 * mail never resurrects and the server cap never clogs.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchInbox, readAck, type ServerEndpoint } from "../client.ts";
import { hasMessage, writeMessage } from "./store.ts";

/** Local mirror of this user's inbox, inside the user-mail dir. */
export function mirrorDir(rootDir: string): string {
	return join(rootDir, "inbox");
}

function pendingPath(rootDir: string): string {
	return join(rootDir, "pending-acks.json");
}

async function readPending(rootDir: string): Promise<string[]> {
	try {
		const parsed = JSON.parse(await readFile(pendingPath(rootDir), "utf-8")) as unknown;
		return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
	} catch {
		return [];
	}
}

async function writePending(rootDir: string, ids: string[]): Promise<void> {
	await writeFile(pendingPath(rootDir), JSON.stringify(ids, null, 2) + "\n", { mode: 0o600 });
}

/**
 * Pull unread from the server into the mirror, deduped against unread and
 * already-read ids. Returns how many new messages landed locally.
 */
export async function pull(endpoint: ServerEndpoint, id: string, rootDir: string): Promise<number> {
	const messages = await fetchInbox(endpoint, id);
	let added = 0;
	for (const message of messages) {
		if (await hasMessage(mirrorDir(rootDir), message.id)) continue;
		await writeMessage(mirrorDir(rootDir), message);
		added += 1;
	}
	return added;
}

/** Record ids the server still lists as unread after a failed read-ack. */
export async function queuePendingAcks(rootDir: string, ids: string[]): Promise<void> {
	if (ids.length === 0) return;
	const pending = await readPending(rootDir);
	const merged = [...new Set([...pending, ...ids])];
	await writePending(rootDir, merged);
}

/** Try to flush pending acks. Failures keep the queue for the next pull. */
export async function flushPendingAcks(
	endpoint: ServerEndpoint,
	id: string,
	rootDir: string,
): Promise<number> {
	const pending = await readPending(rootDir);
	if (pending.length === 0) return 0;
	try {
		await readAck(endpoint, id, pending);
		await writePending(rootDir, []);
		return pending.length;
	} catch {
		return 0;
	}
}
