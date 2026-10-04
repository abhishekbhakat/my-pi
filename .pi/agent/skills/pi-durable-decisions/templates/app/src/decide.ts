import { createHash } from "node:crypto";

export type Question =
  | { id: string; kind: "noul"; instructions: string }
  | { id: string; kind: "choice"; instructions: string; criteria: Record<string, string> }
  | { id: string; kind: "score"; instructions: string; criteria: string[] };

export type Answer = {
  noul?: unknown;
  choice?: unknown;
  score?: unknown;
  probabilities?: unknown;
};

export type Verdict = {
  id: string;
  kind: Question["kind"];
  value: boolean | string | number | "hedge";
  p?: number;
};

const NOUL_TRUE = 0.65;
const NOUL_FALSE = 0.35;
const CHOICE_MARGIN = 0.15;
const SCORE_P = 0.4;

export function verdictKey(question: Question, evidence: string): string {
  const body = JSON.stringify({ question, evidence });
  return createHash("sha256").update(body).digest("hex").slice(0, 24);
}

function probabilitiesOf(answer: Answer): Record<string, number> | undefined {
  const raw = answer.probabilities;
  if (Array.isArray(raw)) {
    const out: Record<string, number> = {};
    raw.forEach((value, index) => {
      if (typeof value === "number" && Number.isFinite(value)) out[String(index)] = value;
    });
    return Object.keys(out).length > 0 ? out : undefined;
  }
  if (raw && typeof raw === "object") {
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
  return undefined;
}

/** Missing fields degrade to a hedge, never to a wrong call. */
export function interpret(question: Question, answer: Answer | undefined): Verdict {
  const hedge: Verdict = { id: question.id, kind: question.kind, value: "hedge" };
  if (!answer) return hedge;
  if (question.kind === "noul") {
    let p: number | undefined;
    if (typeof answer.noul === "number" && Number.isFinite(answer.noul)) p = answer.noul;
    else p = probabilitiesOf(answer)?.["true"];
    if (p === undefined) {
      if (answer.noul === true) return { id: question.id, kind: "noul", value: true, p: 1 };
      if (answer.noul === false) return { id: question.id, kind: "noul", value: false, p: 0 };
      return hedge;
    }
    if (p >= NOUL_TRUE) return { id: question.id, kind: "noul", value: true, p };
    if (p <= NOUL_FALSE) return { id: question.id, kind: "noul", value: false, p };
    return { id: question.id, kind: "noul", value: "hedge", p };
  }
  if (question.kind === "choice") {
    const probabilities = probabilitiesOf(answer);
    let label = typeof answer.choice === "string" ? answer.choice : undefined;
    if (label === undefined && probabilities) {
      const top = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0];
      if (top) label = top[0];
    }
    if (label === undefined) return hedge;
    const p = probabilities?.[label];
    const sorted = Object.values(probabilities ?? {}).sort((a, b) => b - a);
    const margin = sorted.length >= 2 ? sorted[0] - sorted[1] : undefined;
    if (margin !== undefined && margin < CHOICE_MARGIN) return { id: question.id, kind: "choice", value: "hedge", p };
    return { id: question.id, kind: "choice", value: label, p };
  }
  const probabilities = probabilitiesOf(answer);
  let level: number | undefined;
  if (typeof answer.score === "number" && Number.isFinite(answer.score)) level = answer.score;
  else if (probabilities) {
    const top = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0];
    const parsed = Number(top?.[0]);
    if (top && Number.isFinite(parsed)) level = parsed;
  }
  if (level === undefined) return hedge;
  const p = probabilities?.[String(level)];
  if (p !== undefined && p < SCORE_P) return { id: question.id, kind: "score", value: "hedge", p };
  return { id: question.id, kind: "score", value: level, p };
}

function toWire(questions: Question[]): Record<string, Record<string, unknown>> {
  const map: Record<string, Record<string, unknown>> = {};
  for (const question of questions) {
    map[question.id] = { type: question.kind, instructions: question.instructions, criteria: "criteria" in question ? question.criteria : undefined };
  }
  return map;
}

export async function askDecider(questions: Question[], state: Record<string, unknown>): Promise<Record<string, Answer>> {
  const base = process.env.DECIDER_BASE_URL;
  const key = process.env.DECIDER_API_KEY;
  const model = process.env.DECIDER_MODEL;
  if (!base || !key || !model) {
    throw new Error("DECIDER_BASE_URL, DECIDER_API_KEY, DECIDER_MODEL required");
  }
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.DECIDER_AUTH === "x-api-key") headers["x-api-key"] = key;
  else headers.authorization = `Bearer ${key}`;
  const response = await fetch(base, {
    method: "POST",
    headers,
    body: JSON.stringify({ state, model, questions: toWire(questions) }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`decider ${response.status}`);
  const body = (await response.json()) as { answers?: Record<string, Answer>; result?: { answers?: Record<string, Answer> } };
  return body.answers ?? body.result?.answers ?? {};
}
