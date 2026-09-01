import { SessionManager, type SessionInfo } from "@earendil-works/pi-coding-agent";
import { archiveByPath, loadArchive, pruneMissing, type ArchiveEntry } from "./archive";

const FIRST_MESSAGE_MAX = 240;

export interface SessionSummary {
	path: string;
	id: string;
	cwd: string;
	name?: string;
	created: string;
	modified: string;
	messageCount: number;
	firstMessage: string;
	archived: boolean;
	archivedAt?: string;
	/** True when a pi process has registered this session. */
	live?: boolean;
	/** Shell command to resume this session in its original folder. */
	resumeCommand: string;
	parentSessionPath?: string;
}

export interface FolderSummary {
	cwd: string;
	sessionCount: number;
	activeCount: number;
	archivedCount: number;
	latestModified: string;
}

export interface CatalogSnapshot {
	loadedAt: string;
	sessionCount: number;
	folderCount: number;
	archivedCount: number;
	folders: FolderSummary[];
	sessions: SessionSummary[];
}

let cache: CatalogSnapshot | undefined;
let loadPromise: Promise<CatalogSnapshot> | undefined;

function truncate(text: string, max: number): string {
	const oneLine = text.replace(/\s+/g, " ").trim();
	if (oneLine.length <= max) return oneLine;
	return `${oneLine.slice(0, max - 1)}…`;
}

function resumeCommand(cwd: string, id: string, path: string): string {
	const target = path || id;
	if (cwd) {
		return `cd ${shellQuote(cwd)} && pi --session ${shellQuote(target)}`;
	}
	return `pi --session ${shellQuote(target)}`;
}

function shellQuote(value: string): string {
	if (value === "") return "''";
	if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

function toSummary(info: SessionInfo, archived: ArchiveEntry | undefined): SessionSummary {
	return {
		path: info.path,
		id: info.id,
		cwd: info.cwd || "",
		name: info.name,
		created: info.created.toISOString(),
		modified: info.modified.toISOString(),
		messageCount: info.messageCount,
		firstMessage: truncate(info.firstMessage || "(no messages)", FIRST_MESSAGE_MAX),
		archived: Boolean(archived),
		archivedAt: archived?.archivedAt,
		resumeCommand: resumeCommand(info.cwd || "", info.id, info.path),
		parentSessionPath: info.parentSessionPath,
	};
}

function buildFolders(sessions: SessionSummary[]): FolderSummary[] {
	const byCwd = new Map<string, SessionSummary[]>();
	for (const session of sessions) {
		const key = session.cwd || "(unknown)";
		const list = byCwd.get(key);
		if (list) list.push(session);
		else byCwd.set(key, [session]);
	}

	const folders: FolderSummary[] = [];
	for (const [cwd, list] of byCwd) {
		let latest = 0;
		let archivedCount = 0;
		for (const s of list) {
			const t = Date.parse(s.modified);
			if (!Number.isNaN(t) && t > latest) latest = t;
			if (s.archived) archivedCount++;
		}
		folders.push({
			cwd,
			sessionCount: list.length,
			activeCount: list.length - archivedCount,
			archivedCount,
			latestModified: latest ? new Date(latest).toISOString() : "",
		});
	}

	folders.sort((a, b) => {
		const ta = Date.parse(a.latestModified) || 0;
		const tb = Date.parse(b.latestModified) || 0;
		if (tb !== ta) return tb - ta;
		return a.cwd.localeCompare(b.cwd);
	});
	return folders;
}

async function loadFresh(): Promise<CatalogSnapshot> {
	const infos = await SessionManager.listAll();
	const validPaths = new Set(infos.map((s) => s.path));
	pruneMissing(validPaths);
	const archived = archiveByPath(loadArchive());

	const sessions = infos.map((info) => toSummary(info, archived.get(info.path)));
	const folders = buildFolders(sessions);
	const snapshot: CatalogSnapshot = {
		loadedAt: new Date().toISOString(),
		sessionCount: sessions.length,
		folderCount: folders.length,
		archivedCount: sessions.filter((s) => s.archived).length,
		folders,
		sessions,
	};
	cache = snapshot;
	return snapshot;
}

/** Return cached catalog, loading once if empty. */
export async function getCatalog(force = false): Promise<CatalogSnapshot> {
	if (!force && cache) return cache;
	if (!force && loadPromise) return loadPromise;
	loadPromise = loadFresh().finally(() => {
		loadPromise = undefined;
	});
	return loadPromise;
}

export function invalidateCatalog(): void {
	cache = undefined;
}

export function findSession(path: string, snapshot?: CatalogSnapshot): SessionSummary | undefined {
	const sessions = snapshot?.sessions ?? cache?.sessions;
	return sessions?.find((s) => s.path === path);
}
