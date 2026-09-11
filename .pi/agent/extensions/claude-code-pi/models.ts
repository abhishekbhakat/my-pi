export const PROVIDER_ID = "claude-code-cli";
export const API_ID = "claude-code-cli-runner";
export const DEFAULT_CONTEXT_WINDOW = 1_000_000;
export const DEFAULT_MAX_TOKENS = 16_384;

export type ClaudeCodeModelInfo = {
	id: string;
	name: string;
	contextWindow: number;
	maxTokens: number;
	reasoning: boolean;
};

const DEFAULT_MODELS: ClaudeCodeModelInfo[] = [
	{
		id: "sonnet",
		name: "Claude Code Sonnet alias",
		contextWindow: DEFAULT_CONTEXT_WINDOW,
		maxTokens: DEFAULT_MAX_TOKENS,
		reasoning: true,
	},
	{
		id: "opus",
		name: "Claude Code Opus alias",
		contextWindow: DEFAULT_CONTEXT_WINDOW,
		maxTokens: DEFAULT_MAX_TOKENS,
		reasoning: true,
	},
	{
		id: "fable",
		name: "Claude Code Fable alias",
		contextWindow: DEFAULT_CONTEXT_WINDOW,
		maxTokens: DEFAULT_MAX_TOKENS,
		reasoning: true,
	},
];

function dedupe(values: string[]): string[] {
	return [...new Set(values)];
}

function contextWindowOverride(): number | undefined {
	const configured = Number(process.env.CLAUDE_CODE_PI_CONTEXT_WINDOW);
	if (Number.isFinite(configured) && configured > 0) return Math.floor(configured);
	return undefined;
}

export function configuredModels(raw: string | undefined): ClaudeCodeModelInfo[] {
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
			name: known?.name ?? `Claude Code ${id}`,
			contextWindow: contextWindow ?? known?.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
			maxTokens: known?.maxTokens ?? DEFAULT_MAX_TOKENS,
			reasoning: true,
		};
	});
}

export function providerModels(models: ClaudeCodeModelInfo[]) {
	return models.map((model) => ({
		id: model.id,
		name: `${model.name} (Claude Code CLI)`,
		reasoning: model.reasoning,
		input: ["text", "image"] as ("text" | "image")[],
		contextWindow: model.contextWindow,
		maxTokens: model.maxTokens,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	}));
}
