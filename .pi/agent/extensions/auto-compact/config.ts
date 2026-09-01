/**
 * Persistent config for auto-compact threshold extension.
 * Lives at ~/.pi/agent/extensions/auto-compact.json after install.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const CONFIG_NAME = "auto-compact.json";

export const MIN_THRESHOLD = 30;
export const MAX_THRESHOLD = 95;
export const DEFAULT_THRESHOLD = 75;
export const DEFAULT_RETRY_DELAY_MS = 60_000;

/** Thinking levels accepted by the compaction summarizer. */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevelName = (typeof THINKING_LEVELS)[number];

/** Default thinking level for the fixed compaction model. */
export const DEFAULT_COMPACT_THINKING: ThinkingLevelName = "max";

export type ModelRef = { provider: string; modelId: string };

/** Parse "provider/modelId" (modelId may contain further slashes). */
export function parseModelRef(ref: string): ModelRef | undefined {
	const i = ref.indexOf("/");
	if (i <= 0 || i === ref.length - 1) return undefined;
	return { provider: ref.slice(0, i), modelId: ref.slice(i + 1) };
}

export type AutoCompactConfig = {
	/** Master switch. Default true. */
	enabled: boolean;
	/** Trigger when context percent >= this value (0-100 scale). Default 75. */
	thresholdPercent: number;
	/** Show notify messages when compact starts/ends. Default true. */
	notify: boolean;
	/** Cooldown after a failed compact before retrying. Default 60000. */
	retryDelayMs: number;
	/**
	 * Fixed model ("provider/modelId") for compaction summaries.
	 * Empty = stock compaction with the session model.
	 * Never used for overflow recovery; failures fall back to stock.
	 */
	compactModel: string;
	/** Thinking level for the fixed compaction model. Default "max". */
	compactThinking: ThinkingLevelName;
};

export const DEFAULT_CONFIG: AutoCompactConfig = {
	enabled: true,
	thresholdPercent: DEFAULT_THRESHOLD,
	notify: true,
	retryDelayMs: DEFAULT_RETRY_DELAY_MS,
	compactModel: "",
	compactThinking: DEFAULT_COMPACT_THINKING,
};

export function configPath(): string {
	return join(getAgentDir(), "extensions", CONFIG_NAME);
}

function clampThreshold(value: number): number {
	if (!Number.isFinite(value)) return DEFAULT_THRESHOLD;
	return Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, Math.round(value)));
}

function clampRetryDelay(value: number): number {
	if (!Number.isFinite(value) || value < 0) return DEFAULT_RETRY_DELAY_MS;
	return Math.round(value);
}

function cleanCompactModel(value: string | undefined): string {
	if (typeof value !== "string") return "";
	const ref = value.trim();
	return parseModelRef(ref) ? ref : "";
}

function cleanCompactThinking(value: string | undefined): ThinkingLevelName {
	return (THINKING_LEVELS as readonly string[]).includes(value ?? "")
		? (value as ThinkingLevelName)
		: DEFAULT_COMPACT_THINKING;
}

export function readConfig(): AutoCompactConfig {
	const path = configPath();
	if (!existsSync(path)) return { ...DEFAULT_CONFIG };
	try {
		const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<AutoCompactConfig>;
		return {
			enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_CONFIG.enabled,
			thresholdPercent:
				typeof parsed.thresholdPercent === "number"
					? clampThreshold(parsed.thresholdPercent)
					: DEFAULT_CONFIG.thresholdPercent,
			notify: typeof parsed.notify === "boolean" ? parsed.notify : DEFAULT_CONFIG.notify,
			retryDelayMs:
				typeof parsed.retryDelayMs === "number"
					? clampRetryDelay(parsed.retryDelayMs)
					: DEFAULT_CONFIG.retryDelayMs,
			compactModel: cleanCompactModel(parsed.compactModel),
			compactThinking: cleanCompactThinking(parsed.compactThinking),
		};
	} catch (error) {
		console.error(`Warning: Could not parse ${path}: ${error}`);
		return { ...DEFAULT_CONFIG };
	}
}

export function writeConfig(config: AutoCompactConfig): void {
	const next: AutoCompactConfig = {
		enabled: config.enabled,
		thresholdPercent: clampThreshold(config.thresholdPercent),
		notify: config.notify,
		retryDelayMs: clampRetryDelay(config.retryDelayMs),
		compactModel: cleanCompactModel(config.compactModel),
		compactThinking: cleanCompactThinking(config.compactThinking),
	};
	writeFileSync(configPath(), `${JSON.stringify(next, null, 2)}\n`, "utf-8");
}

export function formatUsageLine(percent: number | null | undefined, tokens: number | null | undefined, window: number): string {
	const pct = percent == null ? "?" : `${Math.min(percent, 999).toFixed(1)}%`;
	const tok =
		tokens == null || !window
			? "?"
			: `${tokens.toLocaleString()}/${window.toLocaleString()}`;
	return `${pct} (${tok})`;
}
