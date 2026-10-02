/**
 * Vibe session stats reader.
 *
 * `vibe -p --output json` prints no token accounting, but Vibe records the real
 * provider numbers in `~/.vibe/logs/session/<dir>/meta.json` when the run ends.
 * Those numbers replace the bridge's chars/4 estimate.
 *
 * Directory layout: `session_<YYYYMMDD>_<HHMMSS>_<first 8 of sessionId>`, so the
 * sessionId from the JSON output is matched by prefix.
 *
 * Every failure here is non-fatal: the caller keeps its estimate.
 */

import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type VibeTurnStats = {
	/** Real provider prompt tokens for the last turn. */
	promptTokens: number;
	/** Real provider completion tokens for the last turn. */
	completionTokens: number;
	/** Cached prompt tokens billed at the cached rate. */
	cachedTokens: number;
	/** Provider-reported generation duration in seconds. */
	durationSeconds: number;
	/** Provider-reported output tokens per second, when present. */
	tokensPerSecond: number | null;
};

function sessionsRoot(): string {
	return join(process.env.HOME || homedir(), ".vibe", "logs", "session");
}

function numberAt(value: unknown, key: string): number {
	if (!value || typeof value !== "object") return 0;
	const raw = (value as Record<string, unknown>)[key];
	return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
}

function parseStats(meta: string): VibeTurnStats | null {
	let stats: unknown;
	try {
		stats = (JSON.parse(meta) as { stats?: unknown }).stats;
	} catch {
		return null;
	}
	if (!stats || typeof stats !== "object") return null;
	const completionTokens = numberAt(stats, "last_turn_completion_tokens");
	if (completionTokens <= 0) return null;
	const promptTokens = numberAt(stats, "last_turn_prompt_tokens");
	const durationSeconds = numberAt(stats, "last_turn_duration");
	const rawRate = (stats as Record<string, unknown>).tokens_per_second;
	return {
		promptTokens,
		completionTokens,
		cachedTokens: numberAt(stats, "last_turn_cached_tokens"),
		durationSeconds,
		tokensPerSecond: typeof rawRate === "number" && Number.isFinite(rawRate) ? rawRate : null,
	};
}

/** Real token counts for the turn Vibe recorded under `sessionId`. Null when absent. */
export function readTurnStats(sessionId: string | undefined): VibeTurnStats | null {
	if (!sessionId || sessionId.length < 8) return null;
	const root = sessionsRoot();
	let names: string[];
	try {
		names = readdirSync(root);
	} catch {
		return null;
	}
	const prefix = sessionId.slice(0, 8);
	const match = names
		.filter((name) => name.startsWith("session_") && name.endsWith(`_${prefix}`))
		.sort()
		.pop();
	if (!match) return null;
	try {
		return parseStats(readFileSync(join(root, match, "meta.json"), "utf8"));
	} catch {
		return null;
	}
}

/**
 * Handoff to the token-speed footer: publish the provider-reported rate so the
 * footer shows generation speed, not end-to-end bridge latency. Symbol.for
 * shares the registry key; the footer reads it without importing this module.
 * Stale values are harmless: the footer only accepts entries stamped inside
 * the message window it timed itself.
 */
const TURN_STATS_KEY = Symbol.for("my-pi.vibe.turn-stats");

export function publishTurnStats(stats: VibeTurnStats | null): void {
	if (!stats || stats.tokensPerSecond === null || stats.tokensPerSecond <= 0) return;
	const g = globalThis as typeof globalThis & { [TURN_STATS_KEY]?: { rate: number; at: number } };
	g[TURN_STATS_KEY] = { rate: stats.tokensPerSecond, at: Date.now() };
}