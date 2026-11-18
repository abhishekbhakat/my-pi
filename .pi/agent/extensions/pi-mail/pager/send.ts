import { createHash, randomUUID } from "node:crypto";
import { access, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { errorCode, unlinkIfPresent, withNameLock } from "../names/lock.ts";
import { isPagerKey, readSessionNames, type PagerPresence, type SessionName } from "../names/registry.ts";
import { isProcessId, readProcessStarts } from "../names/process.ts";

const PAGER_DIR = ".pager";
export const MAX_PAGE_CHARS = 4_000;
export const MAX_PAGE_HOP = 3;
export const PAGE_TTL_MS = 30_000;
const RATE_WINDOW_MS = 60_000;
const MAX_PAGES_PER_WINDOW = 5;
const ACK_WAIT_MS = 3_000;

export type PagerTarget = SessionName & { pager: PagerPresence };
export type Page = {
	id: string;
	toSessionId: string;
	fromSessionId: string;
	fromName?: string;
	text: string;
	sentAt: number;
	hop: number;
};

function processDirectoryName(pid: number, start: string): string {
	const identity = createHash("sha256").update(start).digest("hex").slice(0, 24);
	return `${pid}-${identity}`;
}

export function pagerProcessDirectory(mailDir: string, pid: number, start: string): string {
	return join(mailDir, PAGER_DIR, processDirectoryName(pid, start));
}

export async function prunePagerProcesses(mailDir: string): Promise<void> {
	const root = join(mailDir, PAGER_DIR);
	const candidates = (await readdir(root, { withFileTypes: true })).flatMap((entry) => {
		const pid = entry.isDirectory() ? Number(/^([1-9]\d*)-[a-f0-9]{24}$/.exec(entry.name)?.[1]) : NaN;
		return isProcessId(pid) ? [{ pid, name: entry.name }] : [];
	});
	const starts = await readProcessStarts(candidates.map(({ pid }) => pid));
	for (const { pid, name } of candidates) {
		const start = starts.get(pid);
		if (start === null || (start && processDirectoryName(pid, start) !== name)) {
			await rm(join(root, name), { recursive: true, force: true });
		}
	}
}

export function pagerDirectory(processDirectory: string, key: string): string {
	if (!isPagerKey(key)) throw new Error("Invalid pager endpoint key");
	return join(processDirectory, key);
}

function notRunning(to: string): Error {
	return new Error(`${JSON.stringify(to)} is not running or cannot receive pages; use mail instead`);
}

function selectSession(names: ReadonlyMap<string, SessionName>, to: string): SessionName | undefined {
	const exact = names.get(to) ?? [...names.values()].find(({ name }) => name === to.toLowerCase());
	if (exact) return exact;
	const matching = [...names.values()].filter(({ id }) => id.startsWith(to));
	if (matching.length > 1) throw new Error(`Ambiguous session prefix ${JSON.stringify(to)}; use a longer ID`);
	return matching[0];
}

export async function resolvePagerTarget(
	mailDir: string, to: string, names?: ReadonlyMap<string, SessionName>,
): Promise<PagerTarget> {
	const address = to.trim();
	if (!address) throw new Error("to is required");
	const session = selectSession(names ?? await readSessionNames(mailDir), address);
	if (session) {
		for (const owner of [session, ...(session.otherOwners ?? [])]) {
			if (!owner.pager) continue;
			const target = { ...session, pid: owner.pid, processStart: owner.processStart, pager: owner.pager };
			if (await targetIsRunning(mailDir, target)) return target;
		}
	}
	throw notRunning(address);
}

async function targetIsRunning(mailDir: string, target: PagerTarget): Promise<boolean> {
	const starts = await readProcessStarts([target.pid]);
	if (starts.get(target.pid) !== target.processStart) return false;
	try {
		await access(pagerDirectory(pagerProcessDirectory(mailDir, target.pid, target.processStart), target.pager.key));
		return true;
	} catch (error) {
		if (errorCode(error) === "ENOENT") return false;
		throw error;
	}
}

async function rateCount(directory: string, now: number): Promise<number> {
	let count = 0;
	for (const file of await readdir(directory)) {
		if (!file.endsWith(".rate") || !isPagerKey(file.slice(0, -5))) continue;
		const path = join(directory, file);
		if (now - (await stat(path)).mtimeMs < RATE_WINDOW_MS) {
			count++;
			continue;
		}
		await unlinkIfPresent(path);
	}
	return count;
}

export async function sendPage(
	mailDir: string,
	target: PagerTarget,
	sender: { id: string; name?: string; hop: number },
	message: string,
	signal?: AbortSignal,
): Promise<{ id: string; delivered: boolean }> {
	if (target.pid === process.pid) throw new Error("cannot page your own process");
	const text = message.trim();
	if (!text) throw new Error("message must not be empty");
	if (text.length > MAX_PAGE_CHARS) throw new Error(`message exceeds ${MAX_PAGE_CHARS} characters`);
	if (sender.hop > MAX_PAGE_HOP) throw new Error("Pager loop limit reached; reply by mail instead");
	const processDirectory = pagerProcessDirectory(mailDir, target.pid, target.processStart);
	const directory = pagerDirectory(processDirectory, target.pager.key);
	const id = randomUUID();
	await withNameLock(mailDir, async () => {
		signal?.throwIfAborted();
		if (!(await targetIsRunning(mailDir, target))) throw notRunning(target.name);
		const ticket = join(processDirectory, `${id}.rate`);
		const temporary = join(directory, `${id}.tmp`);
		try {
			if ((await rateCount(processDirectory, Date.now())) >= MAX_PAGES_PER_WINDOW) {
				throw new Error(`Pager rate limit for ${target.name}: ${MAX_PAGES_PER_WINDOW} pages per minute; use mail instead`);
			}
			const page: Page = { id, toSessionId: target.id, fromSessionId: sender.id, fromName: sender.name,
				text, sentAt: Date.now(), hop: sender.hop };
			await writeFile(ticket, "", { mode: 0o600, flag: "wx" });
			await writeFile(temporary, JSON.stringify(page), { mode: 0o600, flag: "wx" });
			await rename(temporary, join(directory, `${id}.page`));
		} catch (error) {
			await unlinkIfPresent(temporary);
			await unlinkIfPresent(ticket);
			if (errorCode(error) === "ENOENT") throw notRunning(target.name);
			throw error;
		}
	});
	const ack = join(directory, `${id}.ack`);
	const deadline = performance.now() + ACK_WAIT_MS;
	for (;;) {
		try {
			await access(ack);
			return { id, delivered: true };
		} catch (error) {
			if (errorCode(error) !== "ENOENT") throw error;
		}
		const remaining = deadline - performance.now();
		if (remaining <= 0) break;
		await delay(Math.min(50, remaining), undefined, { signal });
	}
	if (!(await targetIsRunning(mailDir, target))) {
		throw new Error(`${target.name} stopped before acknowledging the page; delivery is unknown`);
	}
	return { id, delivered: false };
}

const SESSION_ID = /^[a-z0-9][a-z0-9-]*$/i;
const SESSION_NAME = /^[a-z]+[1-9][0-9]*$/;

export async function readPage(path: string, id: string, sessionId: string): Promise<Page | undefined> {
	const raw = await readFile(path, "utf8");
	if (raw.length > MAX_PAGE_CHARS * 6 + 512) return;
	let page: Page;
	try {
		page = JSON.parse(raw);
	} catch {
		return;
	}
	if (!page || page.id !== id || page.toSessionId !== sessionId ||
		typeof page.fromSessionId !== "string" || !SESSION_ID.test(page.fromSessionId) ||
		(page.fromName !== undefined && (typeof page.fromName !== "string" || !SESSION_NAME.test(page.fromName))) ||
		typeof page.text !== "string" || !page.text.trim() || page.text.length > MAX_PAGE_CHARS ||
		!Number.isSafeInteger(page.sentAt) || Math.abs(Date.now() - page.sentAt) >= PAGE_TTL_MS ||
		!Number.isInteger(page.hop) || page.hop < 0 || page.hop > MAX_PAGE_HOP) return;
	return page;
}
