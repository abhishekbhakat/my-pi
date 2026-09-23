/**
 * Pin Claude Code CLI models before npm:claude-code-pi loads.
 * Local extensions run before package extensions, so this env is visible
 * when claude-code-pi calls configuredModels(process.env.CLAUDE_CODE_PI_MODELS).
 *
 * Fable is disabled: pinned Opus only, alongside sonnet.
 */
const DEFAULT_MODELS = "sonnet,opus";
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

process.env.CLAUDE_CODE_PI_MODELS = normalizeModelsEnv(process.env.CLAUDE_CODE_PI_MODELS);

export default function claudeCodeModelsEnv() {
	// Env side effect only. Provider registration stays in claude-code-pi.
}
