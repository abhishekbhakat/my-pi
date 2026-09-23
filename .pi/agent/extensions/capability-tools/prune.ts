import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { JEV_API_KEY, JEV_MODEL, JEV_URL } from "../shared/jev-zen";
import { collectSerializedConversation } from "./context";
import type { CapabilityDef } from "./types";

const LISA_ACTIVE = Symbol.for("my-pi.lisa.active");
const THRESHOLD = 0.6;
const CONVERSATION_CHARS = 8000;
const FETCH_MS = 2500;
const CACHE_MS = 90_000;
const CACHE_LIMIT = 100;

const KEYWORDS: Record<string, string> = {
	code_scout: "scout",
	reasoning_coach: "coach",
	patch_reviewer: "review",
	commit_message: "commit",
	boolean_guy: "boolean",
};

type NoulAnswer = { noul?: unknown; probability?: unknown; p?: unknown };

type CacheEntry = { at: number; prune: boolean };

const verdictCache = new Map<string, CacheEntry>();

function noulProb(answer: unknown): number | undefined {
	if (!answer || typeof answer !== "object") return undefined;
	const rec = answer as NoulAnswer;
	const val = rec.noul ?? rec.probability ?? rec.p;
	return typeof val === "number" && Number.isFinite(val) ? val : undefined;
}

function lisaOn(): boolean {
	return (globalThis as Record<symbol, unknown>)[LISA_ACTIVE] === true;
}

function taskOf(input: unknown): string {
	if (!input || typeof input !== "object") return "";
	const task = (input as { task?: unknown }).task;
	return typeof task === "string" ? task.trim() : "";
}

function questionsSummary(input: unknown): string {
	if (!input || typeof input !== "object") return "";
	const questions = (input as { questions?: unknown }).questions;
	if (!Array.isArray(questions)) return "";
	return questions
		.map((q) => (q && typeof q === "object" ? String((q as { id?: unknown }).id ?? "") : ""))
		.filter(Boolean)
		.join(",")
		.slice(0, 300);
}

function mentionedInTask(def: CapabilityDef, task: string): boolean {
	const hay = task.toLowerCase();
	if (hay.includes(def.toolName.toLowerCase())) return true;
	const keyword = KEYWORDS[def.toolName];
	return keyword !== undefined && hay.includes(keyword);
}

function cacheSet(key: string, prune: boolean): void {
	if (verdictCache.size >= CACHE_LIMIT) {
		const now = Date.now();
		for (const [k, v] of verdictCache) {
			if (now - v.at >= CACHE_MS) verdictCache.delete(k);
		}
		if (verdictCache.size >= CACHE_LIMIT) {
			const first = verdictCache.keys().next().value;
			if (first !== undefined) verdictCache.delete(first);
		}
	}
	verdictCache.set(key, { at: Date.now(), prune });
}

export function applyCapabilityPrune(pi: ExtensionAPI, defs: CapabilityDef[]): void {
	const byName = new Map(defs.map((def) => [def.toolName, def]));

	pi.on("tool_call", async (event, ctx) => {
		if (lisaOn()) return;
		const def = byName.get(event.toolName);
		if (!def) return;

		const task = taskOf(event.input);
		if (mentionedInTask(def, task)) return;

		const conversation = await collectSerializedConversation(ctx, CONVERSATION_CHARS);
		const ck = `${def.toolName}|${task}|${conversation.length}|${conversation.slice(-1500)}`;
		const cached = verdictCache.get(ck);
		let prune: boolean;
		if (cached && Date.now() - cached.at < CACHE_MS) {
			prune = cached.prune;
		} else {
			const p = await noulPruneProbability(JEV_API_KEY, def, task, questionsSummary(event.input), conversation, ctx.signal);
			if (p === null) return;
			prune = p >= THRESHOLD;
			cacheSet(ck, prune);
		}

		if (prune) {
			return {
				block: true,
				reason:
					`${def.toolName} skipped: Jev Noul marked this call for pruning (score at least ${THRESHOLD}). ` +
					"Proceed without this helper using read/edit/bash. Do not retry this call.",
			};
		}
	});
}

async function noulPruneProbability(
	apiKey: string,
	def: CapabilityDef,
	task: string,
	questions: string,
	conversation: string,
	parentSignal?: AbortSignal,
): Promise<number | null> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_MS);
	const onParentAbort = () => controller.abort();
	parentSignal?.addEventListener("abort", onParentAbort, { once: true });

	const taskSlice = task.slice(0, 4000);
	try {
		const response = await fetch(JEV_URL, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: JEV_MODEL,
				state: {
					task: taskSlice,
					questions,
					tool: def.toolName,
					purpose: def.description,
					conversation,
				},
				questions: {
					prune: {
						type: "noul",
						instructions:
							`Decide only whether to prune this ${def.toolName} call from the current turn. ` +
							`Helper task: ${task.slice(0, 1500) || "(none)"}. Return true to prune, false to keep.`,
						criteria: {
							true: "Prune this helper call from the current turn.",
							false: "Keep this helper call for the current turn.",
						},
					},
				},
			}),
			signal: controller.signal,
		});
		if (response.status === 401 || response.status === 422 || !response.ok) return null;
		const body = await response.json() as { answers?: { prune?: unknown } };
		return noulProb(body.answers?.prune) ?? null;
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
		parentSignal?.removeEventListener("abort", onParentAbort);
	}
}
