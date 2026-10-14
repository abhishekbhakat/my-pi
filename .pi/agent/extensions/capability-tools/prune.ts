import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { askDeciders } from "../shared/deciders/index.ts";
import type { CapabilityDef } from "./types";

/**
 * Post-call pruning of helper tool results. Jev never blocks a helper call.
 * After a call finishes and a later user turn begins, Jev judges whether the
 * stored result still helps the context; unhelpful results are replaced by a
 * short stub in the model-visible transcript. Fail-open: any decider error
 * keeps the result untouched.
 */

const DROP_THRESHOLD = 0.6;
const RESULT_HEAD = 600;
const FETCH_MS = 2500;
const MAX_QUESTIONS = 16;
const VERDICT_LIMIT = 500;

type NoulAnswer = { noul?: unknown; probability?: unknown; p?: unknown };

const dropVerdicts = new Map<string, boolean>();

function noulProb(answer: unknown): number | undefined {
	if (!answer || typeof answer !== "object") return undefined;
	const rec = answer as NoulAnswer;
	const val = rec.noul ?? rec.probability ?? rec.p;
	return typeof val === "number" && Number.isFinite(val) ? val : undefined;
}

function remember(id: string, drop: boolean): void {
	if (dropVerdicts.size >= VERDICT_LIMIT) {
		const first = dropVerdicts.keys().next().value;
		if (first !== undefined) dropVerdicts.delete(first);
	}
	dropVerdicts.set(id, drop);
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part) => part && typeof part === "object" && (part as { type?: unknown }).type === "text")
		.map((part) => String((part as { text?: unknown }).text ?? ""))
		.join("\n");
}

type Msg = { role?: string; toolCallId?: string; toolName?: string; isError?: boolean; content?: unknown };

export function applyCapabilityPrune(pi: ExtensionAPI, defs: CapabilityDef[]): void {
	const names = new Set(defs.map((def) => def.toolName));

	pi.on("context", async (event, ctx) => {
		const messages = event.messages as unknown as Msg[];

		let lastUser = -1;
		for (let i = messages.length - 1; i >= 0; i--) {
			if (messages[i].role === "user") {
				lastUser = i;
				break;
			}
		}

		// Only results from earlier turns; the current turn always sees them.
		const candidates: Array<{ index: number; id: string; msg: Msg; head: string }> = [];
		for (let i = 0; i < lastUser; i++) {
			const msg = messages[i];
			if (msg.role !== "toolResult" || !msg.toolCallId || !msg.toolName) continue;
			if (!names.has(msg.toolName) || msg.isError === true) continue;
			const head = textOf(msg.content);
			if (head.startsWith("[pruned")) continue;
			candidates.push({ index: i, id: msg.toolCallId, msg, head: head.slice(0, RESULT_HEAD) });
		}
		if (candidates.length === 0) return;

		const unknown = candidates.filter((c) => !dropVerdicts.has(c.id)).slice(-MAX_QUESTIONS);
		if (unknown.length > 0) {
			const latestUser = textOf(messages[lastUser].content).slice(0, 1500);
			const questions: Record<string, unknown> = {};
			unknown.forEach((c, i) => {
				questions[`q${i}`] = {
					type: "noul",
					instructions:
						`Decide whether this ${c.msg.toolName} result is still unhelpful for continuing the work. ` +
						`Latest user message: ${latestUser || "(none)"}. ` +
						`ResultHead: ${c.head || "(empty)"}`,
					criteria: {
						true: "Result is stale, superseded, redundant, or irrelevant to the current work; safe to drop from context.",
						false: "Result holds facts, decisions, or findings still needed to continue.",
					},
				};
			});
			const result = await askDeciders(
				"prune",
				{ task: "Prune helper results that no longer help the context." },
				questions as Parameters<typeof askDeciders>[2],
				{ signal: ctx.signal, timeoutMs: FETCH_MS },
			);
			if (result.ok) {
				unknown.forEach((c, i) => {
					const p = noulProb((result.answers as Record<string, unknown>)[`q${i}`]);
					if (p !== undefined) remember(c.id, p >= DROP_THRESHOLD);
				});
			}
		}

		let changed = false;
		const next = messages.map((msg) => {
			if (msg.role !== "toolResult" || !msg.toolCallId || dropVerdicts.get(msg.toolCallId) !== true) return msg;
			if (!msg.toolName || !names.has(msg.toolName)) return msg;
			changed = true;
			return {
				...msg,
				content: [{ type: "text", text: `[pruned: ${msg.toolName} result judged unhelpful for current context]` }],
			};
		});
		if (!changed) return;
		return { messages: next as unknown as typeof event.messages };
	});
}
