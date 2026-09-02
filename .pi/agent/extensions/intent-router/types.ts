export type Kind = "question" | "instruction";
export type Lane = "ops" | "code" | "terminal";
export type Level = "basic" | "adv" | "readonly";

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
	| "instruction.code.basic"
	| "instruction.code.adv"
	| "instruction.ops.basic"
	| "instruction.ops.adv"
	| "instruction.terminal.readonly"
	| "instruction.terminal.basic"
	| "instruction.terminal.adv";

export interface IntentRouterConfig {
	/** When true, session_start / reload auto-probes and enables routing. */
	defaultEnabled: boolean;
	classifier: ClassifierRef;
	routes: Partial<Record<RouteKey, ModelRef>>;
	migrationNotes: string[];
}

export function instructionRouteKey(lane: Lane, level: Level): RouteKey {
	if (lane === "terminal" && level === "readonly") return "instruction.terminal.readonly";
	if (level === "basic" || level === "adv") {
		return `instruction.${lane}.${level}`;
	}
	throw new Error(`invalid instruction route: ${lane}.${level}`);
}

export interface Decision {
	kind: Kind;
	lane?: Lane;
	level?: Level;
	needsCurrentThread?: boolean;
	includesEnglish: boolean;
	key: RouteKey;
}

export const ROUTE_KEYS: RouteKey[] = [
	"question",
	"instruction.code.basic",
	"instruction.code.adv",
	"instruction.ops.basic",
	"instruction.ops.adv",
	"instruction.terminal.readonly",
	"instruction.terminal.basic",
	"instruction.terminal.adv",
];

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
export const DEFAULT_CLASSIFIER_BASE_URL = "https://openrouter.ai/api/v1";
export const PROBE_PROMPT = "What is a git commit?";

export function modelLabel(ref: ModelRef): string {
	return `${ref.provider}/${ref.id}`;
}

export function formatDecision(decision: Decision): string {
	if (decision.needsCurrentThread) return "stay";
	const suffix = decision.includesEnglish ? "+en" : "";
	if (decision.kind === "question") return "question";
	return `${decision.kind}/${decision.lane}/${decision.level}${suffix}`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
