/**
 * Pin Claude Code CLI models before npm:claude-code-pi loads.
 * Local extensions run before package extensions, so this env is visible
 * when claude-code-pi calls configuredModels(process.env.CLAUDE_CODE_PI_MODELS).
 *
 * Bare alias `fable` tracks latest. We pin `claude-fable-5-1` instead.
 */
const DEFAULT_MODELS = "sonnet,opus,claude-fable-5-1";
const PIN = "claude-fable-5-1";

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
