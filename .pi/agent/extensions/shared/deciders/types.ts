/**
 * Shared types for the decider layer: Jev-compatible decision models
 * (TypeSafe Jev, OpenCode Zen Jev, Cloudflare Clef, Fastino GLiDE,
 * Perplexity pplx-decider). All speak the same state/questions wire format.
 */

export type QuestionKind = "noul" | "choice" | "score";

/** Wire question, same shape every Jev-compatible API accepts. */
export type WireQuestion = {
	type: QuestionKind;
	instructions: string;
	criteria?: unknown;
};

export type WireQuestions = Record<string, WireQuestion>;

export type DeciderAnswer = {
	type?: string;
	noul?: unknown;
	choice?: unknown;
	score?: unknown;
	probabilities?: unknown;
	confidence?: unknown;
	legend?: unknown;
	[key: string]: unknown;
};

export type DeciderOk = {
	ok: true;
	model: string;
	answers: Record<string, DeciderAnswer>;
	usage?: unknown;
};

export type DeciderErrorCode =
	| "no-model"
	| "no-key"
	| "unsupported"
	| "unauthorized"
	| "unprocessable"
	| "state-too-large"
	| "http"
	| "timeout"
	| "aborted"
	| "invalid";

export type DeciderError = {
	ok: false;
	code: DeciderErrorCode;
	message: string;
	model?: string;
};

export type DeciderResult = DeciderOk | DeciderError;

export type DeciderProviderConfig = {
	adapter: "systemone" | "clef";
	baseUrl: string;
	authProvider: string;
	authHeader?: "bearer" | "x-api-key";
	accountId?: string;
};

export type DeciderModelConfig = {
	id: string;
	provider: string;
	model: string;
	urlModel?: string;
	kinds?: string[];
	maxQuestions?: number;
	timeoutMs?: number;
};

export type DeciderRegistry = {
	providers: Record<string, DeciderProviderConfig>;
	models: DeciderModelConfig[];
	roles: Record<string, string | string[]>;
};
