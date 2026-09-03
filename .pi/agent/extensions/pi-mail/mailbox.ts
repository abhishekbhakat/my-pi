import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";

export interface MailMessage {
	id: string;
	fromSessionId: string;
	fromName?: string;
	text: string;
	sentAt: number;
}

export interface QueuedReceipt {
	queued: true;
	id: string;
	to: string;
}

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Max characters in one mail body, and max total unread text per mailbox. */
export const MAX_MAIL_CHARS = 100_000;

export function getMailTtlMs(): number {
	const raw = process.env.PI_MAIL_TTL_MS?.trim();
	if (!raw) return DEFAULT_TTL_MS;
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new Error("PI_MAIL_TTL_MS must be a positive integer number of milliseconds");
	}
	return value;
}

export function getAgentDirPath(): string {
	const configured = process.env.PI_CODING_AGENT_DIR?.trim();
	if (!configured) return join(homedir(), ".pi", "agent");
	return isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
}

export function getMailDir(agentDir: string = getAgentDirPath()): string {
	return join(agentDir, "pi-mail");
}

export function getInboxDir(agentDir: string, sessionId: string): string {
	return join(getMailDir(agentDir), sessionId, "inbox");
}

export function getReadDir(agentDir: string, sessionId: string): string {
	return join(getMailDir(agentDir), sessionId, "read");
}

function sanitizeSessionId(id: string): string {
	const trimmed = id.trim();
	if (!trimmed || trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..")) {
		throw new Error(`Invalid session id: ${JSON.stringify(id)}`);
	}
	return trimmed;
}

export async function queueMail(
	agentDir: string,
	toSessionId: string,
	fromSessionId: string,
	text: string,
	fromName?: string,
): Promise<QueuedReceipt> {
	const to = sanitizeSessionId(toSessionId);
	const from = sanitizeSessionId(fromSessionId);
	if (!text.trim()) throw new Error("message must not be empty");
	if (text.length > MAX_MAIL_CHARS) {
		throw new Error(
			`message exceeds ${MAX_MAIL_CHARS} characters (${text.length} chars)`,
		);
	}
	const existing = await listInbox(agentDir, to);
	const used = existing.reduce((sum, m) => sum + m.text.length, 0);
	if (used + text.length > MAX_MAIL_CHARS) {
		throw new Error(
			`mailbox full: ${used} unread chars + ${text.length} new exceeds ${MAX_MAIL_CHARS}`,
		);
	}
	const inboxDir = getInboxDir(agentDir, to);
	await mkdir(inboxDir, { recursive: true, mode: 0o700 });
	const msg: MailMessage = {
		id: randomUUID(),
		fromSessionId: from,
		...(fromName?.trim() ? { fromName: fromName.trim() } : {}),
		text,
		sentAt: Date.now(),
	};
	const tmpPath = join(inboxDir, `.tmp-${msg.id}.json`);
	const finalPath = join(inboxDir, `${msg.id}.json`);
	await writeFile(tmpPath, JSON.stringify(msg, null, 2) + "\n", { mode: 0o600 });
	await rename(tmpPath, finalPath);
	return { queued: true, id: msg.id, to };
}

export async function listInbox(agentDir: string, sessionId: string): Promise<MailMessage[]> {
	const id = sanitizeSessionId(sessionId);
	let names: string[];
	try {
		names = await readdir(getInboxDir(agentDir, id));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
	const msgs: MailMessage[] = [];
	for (const name of names) {
		if (!name.endsWith(".json") || name.startsWith(".tmp-")) continue;
		try {
			const raw = await readFile(join(getInboxDir(agentDir, id), name), "utf-8");
			const parsed = JSON.parse(raw) as MailMessage;
			if (
				typeof parsed.id === "string" &&
				typeof parsed.text === "string" &&
				parsed.text.length <= MAX_MAIL_CHARS
			) {
				msgs.push(parsed);
			}
		} catch {
			// Skip unreadable entries; never fail the whole inbox on one bad file.
		}
	}
	msgs.sort((a, b) => a.sentAt - b.sentAt);
	return msgs;
}

/** All session ids known on disk (from session filenames). */
export async function listSessionIds(agentDir: string): Promise<string[]> {
	let dirs: string[];
	try {
		dirs = await readdir(join(agentDir, "sessions"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
	const ids = new Set<string>();
	for (const d of dirs) {
		let files: string[];
		try {
			files = await readdir(join(agentDir, "sessions", d));
		} catch {
		continue;
	}
		for (const f of files) {
			const m = /^.*_([^_]+)\.jsonl$/.exec(f);
			if (m) ids.add(m[1]!);
		}
	}
	return [...ids];
}

/** Resolve `to` to a mailbox session id: exact match, else unique id prefix. */
export async function resolveMailbox(agentDir: string, to: string): Promise<string> {
	const trimmed = to.trim();
	if (!trimmed) throw new Error("to is required");
	let stores: string[];
	try {
		stores = await readdir(getMailDir(agentDir));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		stores = [];
	}
	const known = new Set([...stores, ...(await listSessionIds(agentDir))]);
	if (known.has(trimmed)) return trimmed;
	const prefixed = [...known].filter((s) => s.startsWith(trimmed));
	if (prefixed.length === 1) return prefixed[0]!;
	if (prefixed.length > 1) {
		throw new Error(
			`Ambiguous mailbox ${JSON.stringify(to)} matches: ${prefixed.join(", ")}. Use a longer id.`,
		);
	}
	throw new Error(`No such session or mailbox: ${JSON.stringify(to)}`);
}

/** Mark read only after successful injection. Returns acked ids. */
export async function ackMail(agentDir: string, sessionId: string, ids: string[]): Promise<string[]> {
	const id = sanitizeSessionId(sessionId);
	const acked: string[] = [];
	for (const msgId of ids) {
		if (msgId.includes("/")) continue;
		const src = join(getInboxDir(agentDir, id), `${msgId}.json`);
		const destDir = getReadDir(agentDir, id);
		try {
			await mkdir(destDir, { recursive: true, mode: 0o700 });
			await rename(src, join(destDir, `${msgId}.json`));
			acked.push(msgId);
		} catch {
			// Already acked or unreadable; skip without failing the batch.
		}
	}
	return acked;
}

export function mailAgeMs(msg: MailMessage, now = Date.now()): number {
	return now - msg.sentAt;
}

export function isMailStale(msg: MailMessage, now = Date.now(), ttlMs = getMailTtlMs()): boolean {
	return mailAgeMs(msg, now) > ttlMs;
}
