import { formatSkillsForPrompt, getAgentDir } from "@earendil-works/pi-coding-agent";
import type { Skill } from "@earendil-works/pi-coding-agent";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface LisaLock {
	token: string;
	pid: number;
	session: string;
	updatedAt: number;
}

const baseDir = dirname(fileURLToPath(import.meta.url));

export function lisaDir(): string {
	return join(homedir(), ".pi", ".lisa");
}

export function legacyDir(): string {
	return join(getAgentDir(), "extensions", "lisa");
}

export function migrateLegacy(): void {
	const legacyDb = join(legacyDir(), "lisa.db");
	if (existsSync(dbPath()) || !existsSync(legacyDb)) return;
	mkdirSync(lisaDir(), { recursive: true });
	for (const name of ["lisa.db", "session-backup.jsonl", "lisa-backup.db"]) {
		const src = join(legacyDir(), name);
		if (existsSync(src)) copyFileSync(src, join(lisaDir(), name));
	}
}

export function dbPath(): string {
	return join(lisaDir(), "lisa.db");
}

export function lockPath(): string {
	return join(lisaDir(), "owner.lock");
}

export function readLock(): LisaLock | undefined {
	try {
		if (!existsSync(lockPath())) return undefined;
		const parsed = JSON.parse(readFileSync(lockPath(), "utf-8")) as Partial<LisaLock>;
		if (typeof parsed.token !== "string" || typeof parsed.pid !== "number") return undefined;
		const session = typeof parsed.session === "string" ? parsed.session : "unknown";
		const updatedAt = typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0;
		return { token: parsed.token, pid: parsed.pid, session, updatedAt };
	} catch {
		return undefined;
	}
}

export function releaseLock(token: string): void {
	try {
		const lock = readLock();
		if (lock && lock.token === token) unlinkSync(lockPath());
	} catch {
		// Lock stays; next activation reports it.
	}
}

export function pidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

export function acquireLock(token: string, session: string): "acquired" | "held" | "stale" {
	mkdirSync(lisaDir(), { recursive: true });
	const payload = `${JSON.stringify({ token, pid: process.pid, session, updatedAt: Date.now() })}\n`;
	try {
		writeFileSync(lockPath(), payload, { flag: "wx" });
		return "acquired";
	} catch {
		const lock = readLock();
		if (lock && pidAlive(lock.pid) && lock.token !== token) return "held";
		writeFileSync(lockPath(), payload);
		return lock && lock.token === token ? "acquired" : "stale";
	}
}

function esc(value: string): string {
	return value.replace(/'/g, "''");
}

export function dbExec(sql: string): void {
	const run = spawnSync("sqlite3", ["-cmd", ".timeout 5000", dbPath(), sql], { encoding: "utf-8" });
	if (run.status !== 0) throw new Error(`sqlite3 failed: ${(run.stderr || run.error || "").toString().trim()}`);
}

export function dbQuery(sql: string): string {
	const run = spawnSync("sqlite3", ["-cmd", ".timeout 5000", dbPath(), sql], { encoding: "utf-8" });
	if (run.status !== 0) throw new Error(`sqlite3 query failed: ${(run.stderr || run.error || "").toString().trim()}`);
	return (run.stdout || "").trim();
}

export function initDb(): void {
	migrateLegacy();
	mkdirSync(lisaDir(), { recursive: true });
	dbExec(
		[
			"PRAGMA journal_mode=WAL;",
			"PRAGMA busy_timeout=5000;",
			"CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);",
			"CREATE TABLE IF NOT EXISTS tasks(id INTEGER PRIMARY KEY, title TEXT NOT NULL, status TEXT DEFAULT 'open', due TEXT, created INTEGER);",
			"CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, label TEXT, last_seen INTEGER);",
			"CREATE TABLE IF NOT EXISTS memories(key TEXT PRIMARY KEY, value TEXT, updated INTEGER);",
			"CREATE TABLE IF NOT EXISTS handoffs(id INTEGER PRIMARY KEY, recipient TEXT NOT NULL, summary TEXT NOT NULL, created INTEGER, done INTEGER DEFAULT 0);",
			"CREATE TABLE IF NOT EXISTS requests(id INTEGER PRIMARY KEY, title TEXT NOT NULL, status TEXT DEFAULT 'open', created INTEGER, updated INTEGER);",
		].join(" "),
	);
	if (dbQuery("PRAGMA journal_mode;").toLowerCase() !== "wal") throw new Error("WAL check failed");
}

export function recordLisaSession(file: string): void {
	dbExec(
		`INSERT INTO sessions(id, label, last_seen) VALUES('${esc(file)}', 'lisa', ${Date.now()}) ` +
			`ON CONFLICT(id) DO UPDATE SET last_seen=${Date.now()};`,
	);
	dbExec(
		`INSERT INTO meta(key, value) VALUES('canonical_session_file', '${esc(file)}') ` +
			`ON CONFLICT(key) DO UPDATE SET value='${esc(file)}';`,
	);
}

export function recordedLisaSession(): string | undefined {
	try {
		if (existsSync(dbPath())) {
			const canonical = dbQuery("SELECT value FROM meta WHERE key='canonical_session_file';").trim();
			if (canonical && existsSync(canonical)) return canonical;
		}
	} catch {
		// Fall through to restore.
	}
	return restoreLisaSession();
}

export function sessionBackupPath(): string {
	return join(lisaDir(), "session-backup.jsonl");
}

export function dbBackupPath(): string {
	return join(lisaDir(), "lisa-backup.db");
}

export function backupLisaSession(file: string): void {
	copyFileSync(file, sessionBackupPath());
	try {
		spawnSync("sqlite3", [dbPath(), `.backup main '${esc(dbBackupPath())}'`], { encoding: "utf-8" });
	} catch {
		// Transcript backup already done; DB backup stays as is.
	}
	dbExec(`INSERT INTO meta(key, value) VALUES('last_session_file', '${esc(file)}') ` +
		`ON CONFLICT(key) DO UPDATE SET value='${esc(file)}';`);
}

export function restoreLisaSession(): string | undefined {
	try {
		const canonical = dbQuery("SELECT value FROM meta WHERE key='canonical_session_file';").trim();
		const legacy = canonical ? "" : dbQuery("SELECT value FROM meta WHERE key='last_session_file';").trim();
		const file = (canonical || legacy).trim();
		if (!file) return undefined;
		if (existsSync(file)) return file;
		if (!existsSync(sessionBackupPath())) return undefined;
		copyFileSync(sessionBackupPath(), file);
		return file;
	} catch {
		return undefined;
	}
}

export function readPersonality(): string {
	try {
		const text = readFileSync(join(baseDir, "PERSONALITY.md"), "utf-8").trim();
		if (text.length > 0) return text;
	} catch {
		// Fall through to default.
	}
	return "You are Lisa, pilot for this user.";
}

export function pendingHandoffs(): string {
	try {
		return dbQuery("SELECT id || ' | ' || recipient || ' | ' || summary FROM handoffs WHERE done=0 ORDER BY created;");
	} catch {
		return "";
	}
}

export function pendingRequests(): string {
	try {
		return dbQuery("SELECT id || ' | ' || title FROM requests WHERE status='open' ORDER BY created;");
	} catch {
		return "";
	}
}

export function buildLisaPrompt(kept: Skill[], cwd: string): string {
	const open = pendingHandoffs();
	const asks = pendingRequests();
	const prompt = [
		"Lisa mode is ON. This prompt replaces the default pi system prompt.",
		readPersonality(),
		`State DB: ${dbPath()} (journal_mode=WAL). Memories live in table memories(key, value). Handoffs live in table handoffs(recipient, summary, done). Requests live in table requests(title, status).`,
		open ? `Open handoffs (follow up on these):\n${open}` : "Open handoffs: none.",
		asks ? `Open user requests (work these in order):\n${asks}` : "Open user requests: none.",
		"Available tools:",
		"- bash: Execute a bash command in the current working directory. Returns stdout and stderr.",
		"Guidelines:",
		"- Be concise. Show file paths clearly.",
		`Current working directory: ${cwd}`,
	].join("\n\n");
	return `${prompt}${formatSkillsForPrompt(kept, "bash")}`;
}
