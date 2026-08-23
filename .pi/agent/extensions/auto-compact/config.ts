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

export type AutoCompactConfig = {
	/** Master switch. Default true. */
	enabled: boolean;
	/** Trigger when context percent >= this value (0-100 scale). Default 75. */
	thresholdPercent: number;
	/** Show notify messages when compact starts/ends. Default true. */
	notify: boolean;
	/** Cooldown after a failed compact before retrying. Default 60000. */
	retryDelayMs: number;
};

export const DEFAULT_CONFIG: AutoCompactConfig = {
	enabled: true,
	thresholdPercent: DEFAULT_THRESHOLD,
	notify: true,
	retryDelayMs: DEFAULT_RETRY_DELAY_MS,
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
