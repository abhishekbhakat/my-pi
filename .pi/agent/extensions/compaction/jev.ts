/**
 * TypeSafe Jev client for compaction prune. Fail-open on any error.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

const SYSTEMONE_URL = "https://api.typesafe.ai/v1/systemone";
const MODEL = "jev-latest";
const REQUEST_MS = 10_000;

export type NoulQuestion = {
	id: string;
	instructions: string;
	criteria?: { true?: string; false?: string };
};

function agentDir(): string {
	const configured = process.env.PI_CODING_AGENT_DIR?.trim();
	if (!configured) return join(homedir(), ".pi", "agent");
	return isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
}

function loadApiKey(): string | undefined {
	const envKey = process.env.TYPESAFE_API_KEY?.trim();
	if (envKey) return envKey;
	const authPath = join(agentDir(), "skills", "typesafe-ai", "typesafe-auth.json");
	if (!existsSync(authPath)) return undefined;
	try {
		const raw = JSON.parse(readFileSync(authPath, "utf8")) as { api_key?: unknown };
		const key = typeof raw.api_key === "string" ? raw.api_key.trim() : "";
		if (!key || key === "YOUR_TYPESAFE_API_KEY") return undefined;
		return key;
	} catch {
		return undefined;
	}
}

function noulProbability(answers: Record<string, unknown>, id: string): number | undefined {
	const raw = answers[id];
	if (!raw || typeof raw !== "object") return undefined;
	const rec = raw as { noul?: unknown; probability?: unknown; p?: unknown };
	const value = rec.noul ?? rec.probability ?? rec.p;
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export async function askNoulBatch(
	state: Record<string, unknown>,
	questions: NoulQuestion[],
	parent: AbortSignal | undefined,
): Promise<Map<string, number> | undefined> {
	if (questions.length === 0) return new Map();
	const key = loadApiKey();
	if (!key) return undefined;

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REQUEST_MS);
	const onParentAbort = () => controller.abort();
	parent?.addEventListener("abort", onParentAbort, { once: true });

	const map: Record<string, unknown> = {};
	for (const question of questions) {
		const body: Record<string, unknown> = { type: "noul", instructions: question.instructions };
		if (question.criteria) body.criteria = question.criteria;
		map[question.id] = body;
	}

	try {
		const response = await fetch(SYSTEMONE_URL, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${key}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ state, model: MODEL, questions: map }),
			signal: controller.signal,
		});
		if (response.status === 401 || response.status === 422 || !response.ok) return undefined;
		const body = (await response.json()) as { answers?: Record<string, unknown> };
		if (!body.answers || typeof body.answers !== "object") return undefined;
		const out = new Map<string, number>();
		for (const question of questions) {
			const p = noulProbability(body.answers, question.id);
			if (p !== undefined) out.set(question.id, p);
		}
		return out;
	} catch {
		return undefined;
	} finally {
		clearTimeout(timer);
		parent?.removeEventListener("abort", onParentAbort);
	}
}
