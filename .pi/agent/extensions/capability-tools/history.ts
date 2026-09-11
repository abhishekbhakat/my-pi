import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";

export const DEFAULT_HISTORY_LIMIT = 6;
const MAX_QUESTION_CHARS = 20_000;
const MAX_ANSWER_CHARS = 4_000;

export type CapabilityHistoryTurn = {
	question: string;
	answer: string;
	at: number;
};

// Serialize read-modify-write per (session, tool) so concurrent calls in one
// Pi process cannot lose turns. Cross-process races are narrowed by unique tmp
// files plus atomic rename.
const writeQueues = new Map<string, Promise<void>>();

async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
	const prev = writeQueues.get(key) ?? Promise.resolve();
	let release!: () => void;
	const next = new Promise<void>((resolvePromise) => {
		release = resolvePromise;
	});
	writeQueues.set(key, prev.then(() => next));
	await prev;
	try {
		return await fn();
	} finally {
		release();
		if (writeQueues.get(key) === next) writeQueues.delete(key);
	}
}

function agentDir(): string {
	const configured = process.env.PI_CODING_AGENT_DIR?.trim();
	if (!configured) return join(homedir(), ".pi", "agent");
	return isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
}

function historyLimit(): number {
	const raw = Number(process.env.CAPABILITY_HISTORY_LIMIT);
	if (Number.isFinite(raw) && raw >= 1) return Math.min(50, Math.floor(raw));
	return DEFAULT_HISTORY_LIMIT;
}

function sanitize(id: string): string {
	const trimmed = id.trim();
	if (!trimmed || trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..")) {
		throw new Error(`Invalid id: ${JSON.stringify(id)}`);
	}
	return trimmed;
}

function historyPath(sessionId: string, toolName: string): string {
	return join(agentDir(), "capability-tools", "history", sanitize(sessionId), `${sanitize(toolName)}.json`);
}

function clipHead(text: string, max: number): string {
	if (text.length <= max) return text;
	return `${text.slice(0, max)}\n\n[truncated ${text.length - max} chars]`;
}

export async function loadCapabilityHistory(
	sessionId: string | undefined,
	toolName: string,
): Promise<CapabilityHistoryTurn[]> {
	if (!sessionId?.trim()) return [];
	try {
		const raw = await readFile(historyPath(sessionId, toolName), "utf8");
		const parsed = JSON.parse(raw) as { turns?: CapabilityHistoryTurn[] };
		if (!Array.isArray(parsed.turns)) return [];
		return parsed.turns
			.filter((turn) => turn && typeof turn.question === "string" && typeof turn.answer === "string")
			.slice(-historyLimit());
	} catch {
		return [];
	}
}

export async function appendCapabilityHistory(
	sessionId: string | undefined,
	toolName: string,
	question: string,
	answer: string,
): Promise<void> {
	if (!sessionId?.trim()) return;
	const q = question.trim();
	const a = answer.trim();
	if (!q || !a) return;
	await withLock(`${sessionId}/${toolName}`, async () => {
		const turns = await loadCapabilityHistory(sessionId, toolName);
		turns.push({
			question: clipHead(q, MAX_QUESTION_CHARS),
			answer: clipHead(a, MAX_ANSWER_CHARS),
			at: Date.now(),
		});
		const kept = turns.slice(-historyLimit());
		const dest = historyPath(sessionId, toolName);
		await mkdir(dirname(dest), { recursive: true });
		const tmp = `${dest}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
		await writeFile(tmp, `${JSON.stringify({ turns: kept }, null, 2)}\n`, "utf8");
		await rename(tmp, dest);
	});
}

export function formatCapabilityHistory(turns: CapabilityHistoryTurn[]): string {
	if (turns.length === 0) return "";
	return turns
		.map((turn, index) => {
			const n = index + 1;
			return `### Turn ${n}\nQuestion:\n${turn.question}\n\nAnswer:\n${turn.answer}`;
		})
		.join("\n\n");
}
