/**
 * Compaction prune via the shared decider layer (role: compaction).
 * Fail-open on any error: undefined means keep everything.
 */
import { askDeciders } from "../shared/deciders/index.ts";
import type { WireQuestions } from "../shared/deciders/types.ts";

const REQUEST_MS = 10_000;

export type NoulQuestion = {
	id: string;
	instructions: string;
	criteria?: { true?: string; false?: string };
};

export async function askNoulBatch(
	state: Record<string, unknown>,
	questions: NoulQuestion[],
	parent: AbortSignal | undefined,
): Promise<Map<string, number> | undefined> {
	if (questions.length === 0) return new Map();
	const wire: WireQuestions = {};
	for (const question of questions) {
		const body = { type: "noul" as const, instructions: question.instructions };
		wire[question.id] = question.criteria ? { ...body, criteria: question.criteria } : body;
	}
	const result = await askDeciders("compaction", state, wire, { signal: parent, timeoutMs: REQUEST_MS });
	if (!result.ok) return undefined;
	const out = new Map<string, number>();
	for (const question of questions) {
		const value = result.answers[question.id]?.noul;
		if (typeof value === "number" && Number.isFinite(value)) out.set(question.id, value);
	}
	return out;
}
