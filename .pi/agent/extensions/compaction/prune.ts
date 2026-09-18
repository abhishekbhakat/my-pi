/**
 * Slice A: Noul keep_for_summary on toolCall+result pairs.
 * Dynamic threshold: mean - 1.0*sigma, clamped [0.30, 0.70], tight-cluster
 * and small-n gates, ceil(n/4) min-keep. Fail-open on any Jev error.
 */
import type { Message } from "@earendil-works/pi-ai";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { askNoulBatch } from "./jev.ts";

const MAX_QUESTIONS = 16;
const MAX_CALLS = 2;
const RESULT_HEAD = 400;
const GOAL_CAP = 800;
const THRESH_FLOOR = 0.10;
const THRESH_CAP = 0.70;
const K_SIGMA = 1.0;
const ALWAYS_KEEP_TOOLS = new Set(["write", "edit"]);
const EVIDENCE_RE = /\b(FAILED|Error|error:|AssertionError|assert\s|Traceback|Exception)\b/;

export type JevCallBudget = { remaining: number };

export type ToolPair = {
	id: string;
	name: string;
	argsStub: string;
	resultHead: string;
	isError: boolean;
	recency: number;
	alwaysKeep: boolean;
};

function clip(text: string, max: number): string {
	return text.length <= max ? text : text.slice(0, max);
}

function textOf(content: string | Array<{ type: string; text?: string }>): string {
	if (typeof content === "string") return content;
	return content
		.filter((block) => block.type === "text" && typeof block.text === "string")
		.map((block) => block.text as string)
		.join("\n");
}

function lastTurnStart(messages: Message[]): number {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === "user") return i;
	}
	return 0;
}

export function collectToolPairs(messages: Message[]): ToolPair[] {
	const turnStart = lastTurnStart(messages);
	const byId = new Map<string, { name: string; argsStub: string; index: number }>();
	const pairs: ToolPair[] = [];
	let recency = 0;

	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];
		if (msg.role === "assistant") {
			for (const block of msg.content) {
				if (block.type !== "toolCall") continue;
				byId.set(block.id, { name: block.name, argsStub: argsStub(block.arguments), index: i });
			}
		} else if (msg.role === "toolResult") {
			const call = byId.get(msg.toolCallId);
			if (!call) continue;
			const resultHead = textOf(msg.content);
			const evidence = EVIDENCE_RE.test(resultHead);
			const inLastTurn = call.index >= turnStart;
			pairs.push({
				id: msg.toolCallId,
				name: call.name,
				argsStub: call.argsStub,
				resultHead: clip(resultHead, RESULT_HEAD),
				isError: msg.isError === true,
				recency: recency++,
				alwaysKeep:
					ALWAYS_KEEP_TOOLS.has(call.name) || msg.isError === true || evidence || inLastTurn,
			});
		}
	}
	return pairs;
}

function argsStub(args: Record<string, unknown>): string {
	const path = typeof args.path === "string" ? args.path : undefined;
	if (path) return clip(path, 200);
	try {
		return clip(JSON.stringify(args), 200);
	} catch {
		return "";
	}
}

function questionFor(
	pair: ToolPair,
	qid: string,
	goal: string,
): {
	id: string;
	instructions: string;
	criteria: { true: string; false: string };
} {
	return {
		id: qid,
		instructions: `Task: decide if this tool call+result must stay in a compaction summary so another model can continue the work.
Goal (clipped): ${goal || "(none)"}
Tool: ${pair.name}
Args: ${pair.argsStub || "(none)"}
Error: ${pair.isError ? "yes" : "no"}
RecencyIndex: ${pair.recency}
ResultHead: ${pair.resultHead || "(empty)"}`,
		criteria: {
			true: "Needed to continue: writes, failing tests, errors, decisions, current file state, or unique facts.",
			false: "Noise: superseded reads, duplicate greps, failed exploratory probes, or content already implied by later work.",
		},
	};
}

function computeThreshold(probs: number[]): number {
	const n = probs.length;
	if (n < 4) return THRESH_FLOOR;
	const mu = probs.reduce((a, b) => a + b, 0) / n;
	const sigma = Math.sqrt(probs.reduce((a, b) => a + (b - mu) * (b - mu), 0) / n);
	// The 0.70 cap already makes high clusters drop nothing; no sigma gate,
	// a gate on the low side would mass-drop tight low clusters.
	return Math.min(THRESH_CAP, Math.max(THRESH_FLOOR, mu - K_SIGMA * sigma));
}

export async function pruneToolPairs(
	messages: Message[],
	previousSummary: string | undefined,
	signal: AbortSignal | undefined,
	budget: JevCallBudget,
): Promise<Set<string>> {
	const empty = new Set<string>();
	const pairs = collectToolPairs(messages);
	const candidates = pairs.filter((pair) => !pair.alwaysKeep);
	if (candidates.length === 0 || budget.remaining <= 0) return empty;

	const goal = clip(previousSummary ?? "", GOAL_CAP);
	const state = { task: "Prune tool pairs that are not needed in a compaction summary." };
	const toJudge = candidates.slice(0, MAX_QUESTIONS * MAX_CALLS);

	// Phase 1: collect probabilities across batches. Partial results kept.
	const judged: Array<{ pair: ToolPair; p: number }> = [];
	for (let offset = 0; offset < toJudge.length && budget.remaining > 0; offset += MAX_QUESTIONS) {
		if (signal?.aborted) return empty;
		budget.remaining -= 1;
		const batch = toJudge.slice(offset, offset + MAX_QUESTIONS);
		const questions = batch.map((pair, i) => questionFor(pair, `p${offset + i}`, goal));
		const answers = await askNoulBatch(state, questions, signal);
		if (!answers) break;
		for (let i = 0; i < batch.length; i++) {
			const p = answers.get(questions[i].id);
			if (typeof p === "number") judged.push({ pair: batch[i], p });
		}
	}
	if (judged.length === 0) return empty;

	// Phase 2: one threshold over the whole sample, then min-keep top quartile.
	const probs = judged.map((j) => Math.min(1, Math.max(0, j.p)));
	const threshold = computeThreshold(probs);
	const minKeep = Math.ceil(judged.length / 4);
	const ranked = judged
		.slice()
		.sort((a, b) => (b.p - a.p !== 0 ? b.p - a.p : a.pair.id < b.pair.id ? -1 : 1));
	const drop = new Set<string>();
	for (let i = 0; i < ranked.length; i++) {
		if (i < minKeep || ranked[i].p >= threshold) continue;
		drop.add(ranked[i].pair.id);
	}

	const mu = probs.reduce((a, b) => a + b, 0) / probs.length;
	const sigma = Math.sqrt(probs.reduce((a, b) => a + (b - mu) * (b - mu), 0) / probs.length);
	logStats(
		`n=${probs.length} mu=${mu.toFixed(3)} sigma=${sigma.toFixed(3)} ` +
			`threshold=${threshold.toFixed(3)} p=[${probs.map((p) => p.toFixed(2)).join(",")}] ` +
			`dropped=${JSON.stringify([...drop])}\n`,
	);
	return drop;
}

/** Calibration log. Append-only; lives next to this file. Never throws. */
function logStats(line: string): void {
	try {
		appendFileSync(join(import.meta.dir, "prune-stats.log"), `[compaction-prune] ${line}`);
	} catch {
		// calibration is best-effort
	}
}
