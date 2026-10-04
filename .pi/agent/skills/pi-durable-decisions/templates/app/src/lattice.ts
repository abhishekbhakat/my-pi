import { askDecider, interpret, verdictKey, type Question, type Verdict } from "./decide.ts";
import type { VerdictStore } from "./store.ts";

export type Judgment = {
  verdicts: Verdict[];
  hedges: string[];
  asked: number;
  reused: number;
};

/** One CLM batch for every uncached question, store reuse for the rest. */
export async function judge(
  questions: Question[],
  evidence: string,
  state: Record<string, unknown>,
  store: VerdictStore,
): Promise<Judgment> {
  const verdicts: Verdict[] = [];
  const hedges: string[] = [];
  let reused = 0;
  const uncached: Question[] = [];
  for (const question of questions) {
    const cached = store.load(verdictKey(question, evidence));
    if (cached) {
      reused += 1;
      verdicts.push(cached);
      if (cached.value === "hedge") hedges.push(question.id);
    } else {
      uncached.push(question);
    }
  }
  if (uncached.length > 0) {
    const answers = await askDecider(uncached, state);
    for (const question of uncached) {
      const verdict = interpret(question, answers[question.id]);
      store.save(verdictKey(question, evidence), verdict);
      verdicts.push(verdict);
      if (verdict.value === "hedge") hedges.push(question.id);
    }
  }
  return { verdicts, hedges, asked: uncached.length, reused };
}
