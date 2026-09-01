import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface ArchiveEntry {
	/** Absolute path to the session JSONL file. */
	path: string;
	/** Session id when known. */
	id?: string;
	/** ISO timestamp when archived. */
	archivedAt: string;
}

export interface ArchiveStore {
	version: 1;
	entries: ArchiveEntry[];
}

function archivePath(): string {
	return join(getAgentDir(), "ssm-archive.json");
}

function emptyStore(): ArchiveStore {
	return { version: 1, entries: [] };
}

export function loadArchive(): ArchiveStore {
	const file = archivePath();
	if (!existsSync(file)) return emptyStore();
	try {
		const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<ArchiveStore>;
		if (!raw || raw.version !== 1 || !Array.isArray(raw.entries)) return emptyStore();
		const entries = raw.entries.filter(
			(e): e is ArchiveEntry =>
				Boolean(e) && typeof e === "object" && typeof e.path === "string" && typeof e.archivedAt === "string",
		);
		return { version: 1, entries };
	} catch {
		return emptyStore();
	}
}

function writeArchive(store: ArchiveStore): void {
	const file = archivePath();
	const dir = dirname(file);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	const tmp = join(dir, `.ssm-archive-${process.pid}-${Date.now()}.tmp`);
	writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, "utf8");
	try {
		renameSync(tmp, file);
	} catch {
		writeFileSync(file, `${JSON.stringify(store, null, 2)}\n`, "utf8");
		try {
			unlinkSync(tmp);
		} catch {
			// ignore
		}
	}
}

/** Map of absolute session path -> archive entry. */
export function archiveByPath(store: ArchiveStore = loadArchive()): Map<string, ArchiveEntry> {
	const map = new Map<string, ArchiveEntry>();
	for (const entry of store.entries) {
		map.set(entry.path, entry);
	}
	return map;
}

export function isArchived(sessionPath: string, store?: ArchiveStore): boolean {
	return archiveByPath(store).has(sessionPath);
}

export function archiveSession(sessionPath: string, id?: string): ArchiveStore {
	const store = loadArchive();
	const existing = store.entries.findIndex((e) => e.path === sessionPath);
	const entry: ArchiveEntry = {
		path: sessionPath,
		id,
		archivedAt: new Date().toISOString(),
	};
	if (existing >= 0) store.entries[existing] = entry;
	else store.entries.push(entry);
	writeArchive(store);
	return store;
}

export function unarchiveSession(sessionPath: string): ArchiveStore {
	const store = loadArchive();
	store.entries = store.entries.filter((e) => e.path !== sessionPath);
	writeArchive(store);
	return store;
}

/** Drop archive rows whose session files no longer exist. */
export function pruneMissing(validPaths: Set<string>): ArchiveStore {
	const store = loadArchive();
	const next = store.entries.filter((e) => validPaths.has(e.path));
	if (next.length !== store.entries.length) {
		store.entries = next;
		writeArchive(store);
	}
	return store;
}
