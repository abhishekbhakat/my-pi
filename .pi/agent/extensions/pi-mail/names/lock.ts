import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { isProcessId, readProcessStarts } from "./process.ts";

const LOCK_DIR = ".names-lock";
const PID_MARKER = /^(\d+)-[0-9a-f-]{36}$/;
const LOCK_WAIT_MS = 2000;

export function errorCode(error: unknown): string | undefined {
	return (error as NodeJS.ErrnoException).code;
}

export async function unlinkIfPresent(path: string): Promise<void> {
	try {
		await unlink(path);
	} catch (error) {
		if (errorCode(error) !== "ENOENT") throw error;
	}
}

async function removeEmptyDir(path: string): Promise<void> {
	try {
		await rmdir(path);
	} catch (error) {
		if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(errorCode(error) ?? "")) throw error;
	}
}

async function recoverLock(lock: string): Promise<void> {
	let entries: string[];
	try {
		entries = await readdir(lock);
	} catch (error) {
		if (errorCode(error) === "ENOENT") return;
		throw error;
	}
	for (const entry of entries) {
		const pid = Number(PID_MARKER.exec(entry)?.[1]);
		if (!isProcessId(pid)) continue;
		const actual = (await readProcessStarts([pid])).get(pid);
		const marker = join(lock, entry);
		try {
			const expected = await readFile(marker, "utf8");
			if (actual === null || (actual && expected && actual !== expected)) await unlinkIfPresent(marker);
		} catch (error) {
			if (errorCode(error) !== "ENOENT") throw error;
		}
	}
	await removeEmptyDir(lock);
}

export async function withNameLock<T>(mailDir: string, update: () => Promise<T>): Promise<T> {
	await mkdir(mailDir, { recursive: true, mode: 0o700 });
	const lock = join(mailDir, LOCK_DIR);
	const staging = await mkdtemp(join(mailDir, `${LOCK_DIR}-`));
	const marker = `${process.pid}-${randomUUID()}`;
	try {
		const processStart = (await readProcessStarts([process.pid])).get(process.pid) ?? "";
		await writeFile(join(staging, marker), processStart, { mode: 0o600, flag: "wx" });
		const deadline = performance.now() + LOCK_WAIT_MS;
		do {
			try {
				// Rename publishes a nonempty lock directory; it cannot replace a held one.
				await rename(staging, lock);
			} catch (error) {
				const code = errorCode(error);
				const windowsConflict = process.platform === "win32" && (code === "EPERM" || code === "EACCES");
				if (code !== "ENOTEMPTY" && code !== "EEXIST" && !windowsConflict) throw error;
				// Reapers touch only the stale owner's unique marker, not its successor's lock.
				await recoverLock(lock);
				await delay(20);
				continue;
			}
			try {
				return await update();
			} finally {
				await unlinkIfPresent(join(lock, marker));
				await removeEmptyDir(lock);
			}
		} while (performance.now() < deadline);
		throw new Error("Timed out waiting for the pi-mail name registry lock");
	} finally {
		await unlinkIfPresent(join(staging, marker));
		await removeEmptyDir(staging);
	}
}
