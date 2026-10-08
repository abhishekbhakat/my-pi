import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDirPath } from "./sessions.ts";
import { parseToolCalls } from "./prompt.ts";
import { parseXmlToolCalls } from "./claudeTools.ts";

const DEFAULT_MODEL = "morph/morph-v3-fast";
const DEFAULT_TIMEOUT_MS = 6_000;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const INVOKE_OPEN_RE = /<invoke\b/gi;
const PARAM_BODY_RE = /<parameter\s+name="[^"]*"\s*>([\s\S]*?)<\/parameter>/g;

/** Default on. Set CLAUDE_CODE_PI_MORPH_REPAIR=0|false|no to disable. */
export function morphRepairEnabled(): boolean {
	const raw = process.env.CLAUDE_CODE_PI_MORPH_REPAIR?.trim().toLowerCase();
	if (!raw) return true;
	return !(raw === "0" || raw === "false" || raw === "no" || raw === "off");
}

export function morphModelId(): string {
	return process.env.CLAUDE_CODE_PI_MORPH_MODEL?.trim() || DEFAULT_MODEL;
}

export function countInvokes(text: string): number {
	return [...text.matchAll(INVOKE_OPEN_RE)].length;
}

/** True when the reply looks like Anthropic/Claude tool XML, well-formed or not. */
export function looksLikeToolXml(text: string): boolean {
	return /<invoke\b|<\/?function_calls>|<parameter\b/.test(text);
}

export function needsMorphRepair(text: string, parsedCount: number): boolean {
	if (!looksLikeToolXml(text)) return false;
	return countInvokes(text) > parsedCount;
}

function paramBodies(text: string): string[] {
	return [...text.matchAll(PARAM_BODY_RE)].map((match) => (match[1] ?? "").trim());
}

/**
 * Accept Morph output only when it preserves the original calls.
 * Reject invented tools or rewritten argument values.
 */
export function validateMorphRepair(original: string, repaired: string): string | null {
	const originalInvokes = countInvokes(original);
	const repairedInvokes = countInvokes(repaired);
	if (originalInvokes === 0) return "no-invokes-in-source";
	if (repairedInvokes !== originalInvokes) {
		return `invoke-count ${repairedInvokes}!=${originalInvokes}`;
	}
	const parsed = parseXmlToolCalls(repaired);
	if (parsed.length !== originalInvokes) {
		return `parsed-count ${parsed.length}!=${originalInvokes}`;
	}
	for (const body of paramBodies(original)) {
		if (!body) continue;
		if (!repaired.includes(body)) return "value-not-in-repaired";
	}
	for (const body of paramBodies(repaired)) {
		if (!body) continue;
		if (!original.includes(body)) return "value-not-in-source";
	}
	return null;
}

function buildMorphPrompt(broken: string): string {
	return [
		"<instruction>Make this Anthropic tool-call XML well-formed: exactly one <function_calls> wrapper, every <invoke name=\"...\"> and <parameter name=\"...\"> properly opened and closed. Do not change tool names, parameter names, or parameter values. Do not add or remove calls. Output only the XML.</instruction>",
		`<code>\n${broken}\n</code>`,
		"<update>\n<function_calls>\n// ... existing invoke blocks ...\n</function_calls>\n</update>",
	].join("\n");
}

export async function resolveOpenRouterKey(): Promise<string | undefined> {
	const fromEnv =
		process.env.CLAUDE_CODE_PI_MORPH_API_KEY?.trim() ||
		process.env.OPENROUTER_API_KEY?.trim();
	if (fromEnv) return fromEnv;
	try {
		const raw = await readFile(join(getAgentDirPath(), "auth.json"), "utf8");
		const auth = JSON.parse(raw) as { openrouter?: { key?: string; apiKey?: string; api_key?: string } };
		const entry = auth.openrouter;
		const key = entry?.key || entry?.apiKey || entry?.api_key;
		return typeof key === "string" && key.trim() ? key.trim() : undefined;
	} catch {
		return undefined;
	}
}

export type MorphStatus = {
	enabled: boolean;
	ready: boolean;
	model: string;
	hasKey: boolean;
	summary: string;
};

/** Setup/status helper: Morph is ready only when enabled and an OpenRouter key resolves. */
export async function morphStatus(): Promise<MorphStatus> {
	const enabled = morphRepairEnabled();
	const model = morphModelId();
	if (!enabled) {
		return { enabled: false, ready: false, model, hasKey: false, summary: "Morph repair: off (CLAUDE_CODE_PI_MORPH_REPAIR)" };
	}
	const key = await resolveOpenRouterKey();
	const hasKey = Boolean(key);
	if (!hasKey) {
		return {
			enabled: true,
			ready: false,
			model,
			hasKey: false,
			summary:
				`Morph repair: ON but no OpenRouter key (needed to rewrite broken Claude tool XML) — set auth.json openrouter.key, OPENROUTER_API_KEY, or re-run make setup`,
		};
	}
	return { enabled: true, ready: true, model, hasKey: true, summary: `Morph repair: on (${model})` };
}

function extractContent(payload: unknown): string | undefined {
	if (!payload || typeof payload !== "object") return undefined;
	const choices = (payload as { choices?: unknown }).choices;
	if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return undefined;
	const message = (choices[0] as { message?: { content?: unknown } }).message;
	const content = message?.content;
	if (typeof content === "string" && content.trim()) return content;
	return undefined;
}

/**
 * Ask Morph (via OpenRouter) to rewrite broken tool XML.
 * Returns repaired text, or null on any failure. Never throws.
 */
export async function repairToolXml(
	broken: string,
	signal?: AbortSignal,
): Promise<string | null> {
	if (!morphRepairEnabled()) return null;
	const key = await resolveOpenRouterKey();
	if (!key) {
		console.error("morph-repair: skipped no-openrouter-key");
		return null;
	}

	const timeoutMs = Number(process.env.CLAUDE_CODE_PI_MORPH_TIMEOUT_MS);
	const budget = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
	const local = AbortSignal.timeout(budget);
	const combined =
		signal && typeof AbortSignal.any === "function" ? AbortSignal.any([signal, local]) : local;

	try {
		const response = await fetch(OPENROUTER_URL, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${key}`,
				"Content-Type": "application/json",
				"HTTP-Referer": "https://github.com/earendil-works/my-pi",
				"X-Title": "claude-code-pi morph repair",
			},
			body: JSON.stringify({
				model: morphModelId(),
				temperature: 0,
				max_tokens: 2048,
				messages: [{ role: "user", content: buildMorphPrompt(broken) }],
			}),
			signal: combined,
		});
		const bodyText = await response.text();
		let payload: unknown = bodyText;
		try {
			payload = JSON.parse(bodyText);
		} catch {
			console.error(`morph-repair: rejected non-json http=${response.status}`);
			return null;
		}
		if (!response.ok) {
			const err =
				payload &&
				typeof payload === "object" &&
				(payload as { error?: { message?: string } }).error?.message;
			console.error(`morph-repair: rejected http=${response.status} ${err ?? ""}`.trim());
			return null;
		}
		const content = extractContent(payload);
		if (!content) {
			console.error("morph-repair: rejected empty");
			return null;
		}
		const reason = validateMorphRepair(broken, content);
		if (reason) {
			console.error(`morph-repair: rejected ${reason}`);
			return null;
		}
		console.error(`morph-repair: ok n=${countInvokes(content)}`);
		return content;
	} catch (error) {
		const name = error instanceof Error ? error.name : "";
		const message = error instanceof Error ? error.message : String(error);
		if (name === "TimeoutError" || /aborted|timeout/i.test(message)) {
			console.error("morph-repair: timeout");
		} else {
			console.error(`morph-repair: rejected ${message}`);
		}
		return null;
	}
}

/**
 * Parse tool calls; if the reply looks broken and Morph repair is enabled,
 * ask Morph once, then re-parse. Falls through to the first parse on failure.
 */
export async function parseToolCallsWithMorphRepair(
	text: string,
	signal?: AbortSignal,
): Promise<Array<{ name: string; arguments: Record<string, any> }>> {
	const first = parseToolCalls(text);
	if (!needsMorphRepair(text, first.length)) return first;
	const repaired = await repairToolXml(text, signal);
	if (!repaired) return first;
	const second = parseToolCalls(repaired);
	return second.length > first.length ? second : first;
}
