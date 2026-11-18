/**
 * User registry for the user-mail server (issue #5): users.json maps mail
 * ids to registration timestamps. Bare-alias lookups run against it.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface Registry {
	[id: string]: { registeredAt: number; lastSeenAt: number };
}

/** Mailbox ids double as directory names: keep them plain. */
const MAILBOX_ID = /^[A-Za-z0-9][A-Za-z0-9@._-]{0,127}$/;

export function badMailboxId(id: string): boolean {
	return !MAILBOX_ID.test(id) || id.includes("..");
}

export async function loadRegistry(rootDir: string): Promise<Registry> {
	try {
		const parsed = JSON.parse(await readFile(join(rootDir, "users.json"), "utf-8")) as Registry;
		if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
			return Object.assign(Object.create(null) as Registry, parsed);
		}
	} catch {
		// Missing or corrupt registry starts empty.
	}
	return Object.create(null) as Registry;
}

export async function saveRegistry(rootDir: string, registry: Registry): Promise<void> {
	await mkdir(rootDir, { recursive: true, mode: 0o700 });
	const temporary = join(rootDir, `.users-${randomUUID()}.tmp`);
	try {
		await writeFile(temporary, JSON.stringify(registry, null, 2) + "\n", { mode: 0o600 });
		await rename(temporary, join(rootDir, "users.json"));
	} finally {
		await unlink(temporary).catch(() => {});
	}
}
