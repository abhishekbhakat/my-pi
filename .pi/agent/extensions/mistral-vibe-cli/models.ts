export const PROVIDER_ID = "mistral-vibe-cli";
export const API_ID = "mistral-vibe-cli-runner";
export const DEFAULT_CONTEXT_WINDOW = 262_144;
export const DEFAULT_MAX_TOKENS = 128_000;

export type VibeCliModelInfo = {
	id: string;
	name: string;
	contextWindow: number;
	maxTokens: number;
};

// "default" runs Vibe with its own configured active_model. Every other id is
// a Vibe model alias pinned per turn through VIBE_ACTIVE_MODEL. Context
// windows stay generic here; models.json modelOverrides tune them per model.
const DEFAULT_MODELS: VibeCliModelInfo[] = [
	{
		id: "default",
		name: "Vibe active model",
		contextWindow: DEFAULT_CONTEXT_WINDOW,
		maxTokens: DEFAULT_MAX_TOKENS,
	},
	{
		id: "glm-5.3",
		name: "GLM 5.3 (Vibe)",
		contextWindow: DEFAULT_CONTEXT_WINDOW,
		maxTokens: DEFAULT_MAX_TOKENS,
	},
];

function dedupe(values: string[]): string[] {
	return [...new Set(values)];
}

function contextWindowOverride(): number | undefined {
	const configured = Number(process.env.MISTRAL_VIBE_CLI_CONTEXT_WINDOW);
	if (Number.isFinite(configured) && configured > 0) return Math.floor(configured);
	return undefined;
}

export function configuredModels(raw: string | undefined): VibeCliModelInfo[] {
	const configured = raw
		?.split(/[\s,]+/)
		.map((part) => part.trim())
		.filter(Boolean);

	const ids = configured && configured.length > 0 ? dedupe(configured) : DEFAULT_MODELS.map((model) => model.id);
	const defaults = new Map(DEFAULT_MODELS.map((model) => [model.id, model]));
	const contextWindow = contextWindowOverride();

	return ids.map((id) => {
		const known = defaults.get(id);
		if (known && !contextWindow) return known;
		return {
			id,
			name: known?.name ?? `Vibe model ${id}`,
			contextWindow: contextWindow ?? known?.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
			maxTokens: known?.maxTokens ?? DEFAULT_MAX_TOKENS,
		};
	});
}

export function providerModels(models: VibeCliModelInfo[]) {
	return models.map((model) => ({
		id: model.id,
		name: `${model.name} (Mistral Vibe CLI)`,
		// Vibe -p exposes no thinking flag; Vibe's own model config decides actual reasoning.
		reasoning: true,
		input: ["text"] as ("text")[],
		contextWindow: model.contextWindow,
		maxTokens: model.maxTokens,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	}));
}
