/** Session mirror: Pi id ↔ Claude UUID under ~/.pi/agent/claude-code-sdk/sessions/. */
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import type { Message } from "@earendil-works/pi-ai";

let activePiSessionId: string | undefined;

export function setActivePiSessionId(id: string | undefined): void {
	activePiSessionId = id?.trim() || undefined;
}

export function getActivePiSessionId(): string | undefined {
	return activePiSessionId;
}

export const RECORD_VERSION = 1;

export type SessionRecord = {
	version: number;
	piSessionId: string;
	claudeSessionId: string;
	initialized: boolean;
	syncedCount: number;
	syncedHash: string;
	systemHash: string;
	lastReplyHash?: string;
	lastMode?: "seed" | "resume" | "none";
	cwd: string;
	createdAt: number;
	lastTurnAt: number;
};

export function hashText(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

export function hashSystemPrompt(systemPrompt: string | undefined): string {
	return hashText(systemPrompt ?? "");
}

export function getAgentDirPath(): string {
	const configured = process.env.PI_CODING_AGENT_DIR?.trim();
	if (!configured) return join(homedir(), ".pi", "agent");
	return isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
}

export function sessionsDir(agentDir = getAgentDirPath()): string {
	return join(agentDir, "claude-code-sdk", "sessions");
}

function recordPath(piSessionId: string, agentDir = getAgentDirPath()): string {
	return join(sessionsDir(agentDir), `${sanitizeId(piSessionId)}.json`);
}

function sanitizeId(id: string): string {
	const trimmed = id.trim();
	if (!trimmed || trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..")) {
		throw new Error(`Invalid session id: ${JSON.stringify(id)}`);
	}
	return trimmed;
}

export function hashMessages(messages: Message[]): string {
	const hash = createHash("sha256");
	hash.update(JSON.stringify(messages.map((m) => m.role)));
	hash.update(String(messages.length));
	for (const message of messages) {
		hash.update(message.role);
		if ("content" in message) {
			hash.update(typeof message.content === "string" ? message.content : JSON.stringify(message.content));
		}
	}
	return hash.digest("hex");
}

export async function loadRecord(piSessionId: string): Promise<SessionRecord | undefined> {
	try {
		const raw = await readFile(recordPath(piSessionId), "utf8");
		const parsed = JSON.parse(raw) as SessionRecord;
		if (!parsed?.claudeSessionId || parsed.piSessionId !== piSessionId) return undefined;
		return {
			version: RECORD_VERSION,
			initialized: false,
			syncedCount: 0,
			syncedHash: "",
			systemHash: "",
			...parsed,
		};
	} catch {
		return undefined;
	}
}

export async function saveRecord(record: SessionRecord): Promise<void> {
	const dir = sessionsDir();
	await mkdir(dir, { recursive: true });
	const dest = recordPath(record.piSessionId);
	const tmp = `${dest}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
	await writeFile(tmp, `${JSON.stringify(record, null, 2)}\n`, "utf8");
	await rename(tmp, dest);
}

export async function ensureRecord(piSessionId: string, cwd: string): Promise<SessionRecord> {
	const existing = await loadRecord(piSessionId);
	if (existing) return existing;
	const now = Date.now();
	const record: SessionRecord = {
		version: RECORD_VERSION,
		piSessionId,
		claudeSessionId: randomUUID(),
		initialized: false,
		syncedCount: 0,
		syncedHash: "",
		systemHash: "",
		cwd,
		createdAt: now,
		lastTurnAt: now,
	};
	await saveRecord(record);
	return record;
}

export function canResume(record: SessionRecord, messages: Message[]): boolean {
	if (!record.initialized || record.syncedCount <= 0) return false;
	if (messages.length < record.syncedCount) return false;
	return hashMessages(messages.slice(0, record.syncedCount)) === record.syncedHash;
}

export async function markSeeded(
	record: SessionRecord,
	messages: Message[],
	systemPrompt: string | undefined,
	mode: "seed" | "resume" | "none",
	replyText?: string,
): Promise<void> {
	record.initialized = true;
	record.syncedCount = messages.length;
	record.syncedHash = hashMessages(messages);
	record.systemHash = hashSystemPrompt(systemPrompt);
	record.lastMode = mode;
	record.lastTurnAt = Date.now();
	if (replyText !== undefined) record.lastReplyHash = hashText(replyText);
	await saveRecord(record);
}

export async function noteMode(piSessionId: string, mode: "none"): Promise<void> {
	const record = await loadRecord(piSessionId);
	if (!record) return;
	record.lastMode = mode;
	record.lastTurnAt = Date.now();
	await saveRecord(record);
}

export async function reseedRecord(piSessionId: string, cwd: string): Promise<SessionRecord> {
	const now = Date.now();
	const record: SessionRecord = {
		version: RECORD_VERSION,
		piSessionId,
		claudeSessionId: randomUUID(),
		initialized: false,
		syncedCount: 0,
		syncedHash: "",
		systemHash: "",
		cwd,
		createdAt: now,
		lastTurnAt: now,
	};
	await saveRecord(record);
	return record;
}

/** Best-effort delete of Claude's on-disk transcript for this UUID. */
export async function deleteClaudeSessionFile(
	claudeSessionId: string,
	cwd: string,
): Promise<string | undefined> {
	const home = process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), ".claude");
	const munged = cwd.replace(/[^a-zA-Z0-9]/g, "-");
	const candidate = join(home, "projects", munged, `${claudeSessionId}.jsonl`);
	try {
		await rm(candidate, { force: true });
		return candidate;
	} catch {
		return undefined;
	}
}
