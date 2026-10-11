/**
 * Pin Claude Code models before claude-code-sdk loads.
 * Local extensions run in path order; this env is visible when
 * configuredModels() reads CLAUDE_CODE_SDK_MODELS / CLAUDE_CODE_PI_MODELS.
 *
 * Fable is disabled: pinned Opus only, alongside sonnet and haiku.
 */
const DEFAULT_MODELS = "sonnet,opus,haiku";
const PIN = "opus";

function normalizeModelsEnv(raw: string | undefined): string {
	if (!raw?.trim()) return DEFAULT_MODELS;
	const ids = raw
		.split(/[\s,]+/)
		.map((part) => part.trim())
		.filter(Boolean)
		.map((id) => (id === "fable" ? PIN : id));
	if (!ids.includes(PIN)) ids.push(PIN);
	return [...new Set(ids)].join(",");
}

const normalized = normalizeModelsEnv(
	process.env.CLAUDE_CODE_SDK_MODELS ?? process.env.CLAUDE_CODE_PI_MODELS,
);
process.env.CLAUDE_CODE_SDK_MODELS = normalized;
process.env.CLAUDE_CODE_PI_MODELS = normalized;

export default function claudeCodeModelsEnv() {
	// Env side effect only. Provider registration stays in claude-code-sdk.
}
