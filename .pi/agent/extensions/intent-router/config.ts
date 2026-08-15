import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	DEFAULT_CLASSIFIER_BASE_URL,
	DEFAULT_GEMINI_MODEL,
	isRecord,
	ROUTE_KEYS,
	type ClassifierBackend,
	type ClassifierRef,
	type IntentRouterConfig,
	type ModelRef,
	type RouteKey,
} from "./types";

export const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
export const CONFIG_PATH = join(EXTENSION_DIR, "config.json");
export const SAMPLE_CONFIG_PATH = join(EXTENSION_DIR, "sample.config.json");

function parseOptionalModelRef(value: unknown, label: string): ModelRef | undefined {
	if (value === null || value === undefined || value === "") return undefined;
	if (!isRecord(value)) throw new Error(`Invalid model ref: ${label}`);
	const provider = typeof value.provider === "string" ? value.provider.trim() : "";
	const id = typeof value.id === "string" ? value.id.trim() : "";
	if (!provider && !id) return undefined;
	if (!provider || !id) throw new Error(`Incomplete model ref: ${label}`);
	return { provider, id };
}

function resolveBackend(raw: Record<string, unknown>): ClassifierBackend {
	if (raw.backend === "gemini" || raw.backend === "openrouter") return raw.backend;
	const provider = typeof raw.provider === "string" ? raw.provider.toLowerCase() : "";
	const id = typeof raw.id === "string" ? raw.id.toLowerCase() : "";
	if (provider === "google" || provider === "gemini" || id.includes("gemini")) return "gemini";
	return "openrouter";
}

function parseClassifier(raw: Record<string, unknown>): ClassifierRef {
	const backend = resolveBackend(raw);
	const apiKey = typeof raw.apiKey === "string" ? raw.apiKey.trim() : "";
	const baseUrl = typeof raw.baseUrl === "string" ? raw.baseUrl.trim() : "";
	const thinkingLevel = typeof raw.thinkingLevel === "string" ? raw.thinkingLevel.trim() : "";
	const id = typeof raw.id === "string" ? raw.id.trim() : "";
	const provider = typeof raw.provider === "string" ? raw.provider.trim() : "";
	return {
		backend,
		provider: provider || (backend === "gemini" ? "google" : "openrouter"),
		id: id || (backend === "gemini" ? DEFAULT_GEMINI_MODEL : ""),
		maxTokens: typeof raw.maxTokens === "number" ? raw.maxTokens : 1024,
		thinkingLevel: thinkingLevel || undefined,
		apiKey: apiKey || undefined,
		baseUrl: baseUrl || (backend === "openrouter" ? DEFAULT_CLASSIFIER_BASE_URL : undefined),
		retries: typeof raw.retries === "number" ? Math.max(0, Math.floor(raw.retries)) : 1,
		retryDelayMs: typeof raw.retryDelayMs === "number" ? Math.max(0, Math.floor(raw.retryDelayMs)) : 250,
	};
}

export function loadConfig(): IntentRouterConfig | null {
	if (!existsSync(CONFIG_PATH)) return null;
	const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as unknown;
	if (!isRecord(raw) || !isRecord(raw.routes) || !isRecord(raw.classifier)) {
		throw new Error("intent-router config missing classifier/routes");
	}
	const routes: Partial<Record<RouteKey, ModelRef>> = {};
	const migrationNotes: string[] = [];
	for (const key of ROUTE_KEYS) {
		const parsed = parseOptionalModelRef(raw.routes[key], key);
		if (parsed) routes[key] = parsed;
	}
	const leftoverTool = parseOptionalModelRef(raw.routes.tool, "tool");
	if (leftoverTool && !routes["instruction.terminal.readonly"]) {
		routes["instruction.terminal.readonly"] = leftoverTool;
		migrationNotes.push(
			"routes.tool is deprecated; copied to instruction.terminal.readonly. Remove routes.tool from config.json.",
		);
	} else if (leftoverTool) {
		migrationNotes.push("routes.tool is ignored. Use instruction.terminal.readonly.");
	}
	const classifier = parseClassifier(raw.classifier);
	if (!classifier.id) throw new Error("intent-router classifier.id is required");
	return {
		allowEnable: raw.enabled !== false,
		classifier,
		routes,
		migrationNotes,
	};
}

export function resolveConfigApiKey(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const envName = value.match(/^\$([A-Za-z_][A-Za-z0-9_]*)$/);
	if (!envName) return value;
	const fromEnv = process.env[envName[1]];
	return fromEnv && fromEnv.trim() ? fromEnv : undefined;
}
