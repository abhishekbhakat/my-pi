/**
 * Jev Noul: which table columns may shrink under the row ceiling.
 * Missing key or HTTP failure returns null (caller peels numeric).
 * Never print the API key.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SYSTEMONE_URL = "https://api.typesafe.ai/v1/systemone";
const NOUL_PEEL_THRESHOLD = 0.5;
const MAX_QUESTIONS = 16;
const SAMPLE_CAP = 6;

function authPaths(): string[] {
	const here = dirname(fileURLToPath(import.meta.url));
	const skills = dirname(here);
	const homeSkills = join(homedir(), ".pi", "agent", "skills");
	return [
		join(skills, "typesafe-ai", "typesafe-auth.json"),
		join(homeSkills, "typesafe-ai", "typesafe-auth.json"),
	];
}

function loadApiKey(): string | undefined {
	const env = process.env.TYPESAFE_API_KEY?.trim();
	if (env) return env;
	for (const p of authPaths()) {
		if (!existsSync(p)) continue;
		try {
			const raw = JSON.parse(readFileSync(p, "utf8")) as { api_key?: unknown };
			const key = typeof raw.api_key === "string" ? raw.api_key.trim() : "";
			if (key && key !== "YOUR_TYPESAFE_API_KEY") return key;
		} catch {
			continue;
		}
	}
	return undefined;
}

function noulProb(answer: unknown): number | undefined {
	if (!answer || typeof answer !== "object") return undefined;
	const rec = answer as Record<string, unknown>;
	for (const field of ["noul", "probability"] as const) {
		const val = rec[field];
		if (typeof val === "boolean") return val ? 1 : 0;
		if (typeof val === "number") return val;
	}
	return undefined;
}

export async function columnMayPeel(
	headers: string[],
	samples: string[][],
	maxes: number[],
	target: number,
): Promise<boolean[] | null> {
	const n = headers.length;
	if (n === 0) return null;
	const key = loadApiKey();
	if (!key) return null;

	const ask = Math.min(n, MAX_QUESTIONS);
	const questions: Record<string, unknown> = {};
	const columnsState: unknown[] = [];
	for (let i = 0; i < ask; i++) {
		const header = headers[i];
		const sample = samples[i].slice(0, SAMPLE_CAP).filter(Boolean);
		const shown = sample.length > 0 ? sample.join("; ") : "(empty)";
		questions[`col_${i}`] = {
			type: "noul",
			instructions:
				`A GFM markdown table must fit ${target} characters per row. ` +
				`Column ${i} header ${JSON.stringify(header)} has max cell width ${maxes[i]}. ` +
				`Sample cells: ${shown}. ` +
				"True if this column should shrink below that max " +
				"(long prose or dump text; a few overflow cells are ok). " +
				"False if it is a short label or code column " +
				"and must keep its full max width.",
			criteria: {
				true: "Long dump column; shrinking is ok.",
				false: "Short label column; keep full max width.",
			},
		};
		columnsState.push({
			index: i,
			header,
			max_width: maxes[i],
			samples: sample,
		});
	}

	const body = {
		model: process.env.TYPESAFE_MODEL ?? "jev-latest",
		state: {
			task:
				"Decide which markdown table columns may shrink so every " +
				`typical row fits in ${target} characters.`,
			headers: headers.slice(0, ask),
			columns: columnsState,
		},
		questions,
	};

	let response: Response;
	try {
		response = await fetch(SYSTEMONE_URL, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${key}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(30_000),
		});
	} catch {
		console.error("justify: TypeSafe request failed; numeric peel.");
		return null;
	}

	if (response.status === 401) {
		console.error(
			"justify: TypeSafe 401; numeric peel. Set TYPESAFE_API_KEY or typesafe-auth.json.",
		);
		return null;
	}
	if (!response.ok) {
		console.error(`justify: TypeSafe HTTP ${response.status}; numeric peel.`);
		return null;
	}

	let parsed: { answers?: unknown };
	try {
		parsed = (await response.json()) as { answers?: unknown };
	} catch {
		console.error("justify: TypeSafe non-JSON; numeric peel.");
		return null;
	}
	const answers = parsed.answers;
	if (!answers || typeof answers !== "object") {
		console.error("justify: TypeSafe missing answers; numeric peel.");
		return null;
	}

	const rec = answers as Record<string, unknown>;
	const peel = Array.from({ length: n }, () => false);
	for (let i = 0; i < ask; i++) {
		const prob = noulProb(rec[`col_${i}`]);
		peel[i] = prob !== undefined && prob >= NOUL_PEEL_THRESHOLD;
	}
	return peel;
}
