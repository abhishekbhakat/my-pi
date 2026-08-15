export type Kind = "question" | "instruction";
export type Lane = "ops" | "code" | "terminal";
export type Level = "basic" | "adv";

export interface ModelRef {
	provider: string;
	id: string;
}

export type ClassifierBackend = "openrouter" | "gemini";

export interface ClassifierRef extends ModelRef {
	backend: ClassifierBackend;
	maxTokens?: number;
	thinkingLevel?: string;
	apiKey?: string;
	baseUrl?: string;
	retries?: number;
	retryDelayMs?: number;
}

export type RouteKey =
	| "question"
	| "tool"
	| "instruction.code.basic"
	| "instruction.code.adv"
	| "instruction.ops.basic"
	| "instruction.ops.adv"
	| "instruction.terminal.basic"
	| "instruction.terminal.adv";

export interface IntentRouterConfig {
	allowEnable: boolean;
	classifier: ClassifierRef;
	routes: Partial<Record<RouteKey, ModelRef>>;
}

export interface Decision {
	kind: Kind;
	lane?: Lane;
	level?: Level;
	tool?: string;
	needsCurrentThread?: boolean;
	includesEnglish: boolean;
	key: RouteKey;
}

export interface ToolInfo {
	name: string;
	description: string;
}

export const ROUTE_KEYS: RouteKey[] = [
	"question",
	"tool",
	"instruction.code.basic",
	"instruction.code.adv",
	"instruction.ops.basic",
	"instruction.ops.adv",
	"instruction.terminal.basic",
	"instruction.terminal.adv",
];

export const DEFAULT_GEMINI_MODEL = "gemini-3.7-flash";
export const DEFAULT_CLASSIFIER_BASE_URL = "https://openrouter.ai/api/v1";
export const PROBE_PROMPT = "What is a git commit?";

export function modelLabel(ref: ModelRef): string {
	return `${ref.provider}/${ref.id}`;
}

export function formatDecision(decision: Decision): string {
	if (decision.needsCurrentThread) return "stay";
	const suffix = decision.includesEnglish ? "+en" : "";
	if (decision.tool) return `tool/${decision.tool}${suffix}`;
	if (decision.kind === "question") return "question";
	return `${decision.kind}/${decision.lane}/${decision.level}${suffix}`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
