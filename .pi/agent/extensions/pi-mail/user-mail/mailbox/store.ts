/**
 * Message store over one directory (issue #5).
 *
 * Layout: <root>/<id>.json for unread, <root>/read/<id>.json for read.
 * The same store backs the server's inboxes/<alias@username>/ and the
 * client's local inbox/ mirror. Writes are tmp-file-then-rename so a crash
 * never leaves a half message.
 */

import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseEnvelope, type MailEnvelope } from "../protocol.ts";

/** Message ids double as file names: keep them plain. */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function safeId(id: string): string {
	if (!SAFE_ID.test(id)) {
		throw new Error(`Unsafe message id: ${JSON.stringify(id)}`);
	}
	return id;
}

async function exists(path: string): Promise<boolean> {
	try {
		await readFile(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}

/** Write one envelope as unread. Overwrites a file with the same id. */
export async function writeMessage(root: string, envelope: MailEnvelope): Promise<void> {
	safeId(envelope.id);
	await mkdir(root, { recursive: true, mode: 0o700 });
	const tmpPath = join(root, `.tmp-${envelope.id}.json`);
	await writeFile(tmpPath, JSON.stringify(envelope, null, 2) + "\n", { mode: 0o600 });
	await rename(tmpPath, join(root, `${envelope.id}.json`));
}

/**
 * All unread messages, oldest first. Skips tmp files and unreadable or
 * invalid entries instead of failing the whole listing.
 */
export async function listUnread(root: string): Promise<MailEnvelope[]> {
	let names: string[];
	try {
		names = await readdir(root);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
	const messages: MailEnvelope[] = [];
	for (const name of names) {
		if (!name.endsWith(".json") || name.startsWith(".tmp-")) continue;
		try {
			const raw = await readFile(join(root, name), "utf-8");
			const parsed = parseEnvelope(JSON.parse(raw));
			if (parsed) messages.push(parsed);
		} catch {
			// One bad file never fails the batch.
		}
	}
	messages.sort((a, b) => a.sentAt - b.sentAt);
	return messages;
}

/** True when the id sits in unread or read. Used for pull dedupe. */
export async function hasMessage(root: string, id: string): Promise<boolean> {
	safeId(id);
	return (
		(await exists(join(root, `${id}.json`))) ||
		(await exists(join(root, "read", `${id}.json`)))
	);
}

/** Move messages to read/. Returns the ids actually moved. */
export async function ackMessages(root: string, ids: string[]): Promise<string[]> {
	const acked: string[] = [];
	for (const id of ids) {
		safeId(id);
		try {
			const readDir = join(root, "read");
			await mkdir(readDir, { recursive: true, mode: 0o700 });
			await rename(join(root, `${id}.json`), join(readDir, `${id}.json`));
			acked.push(id);
		} catch {
			// Already acked or unreadable; skip without failing the batch.
		}
	}
	return acked;
}

/** Total unread body characters, for the per-inbox cap. */
export async function unreadChars(root: string): Promise<number> {
	const messages = await listUnread(root);
	return messages.reduce((sum, m) => sum + m.text.length, 0);
}
