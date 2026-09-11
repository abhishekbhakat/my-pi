import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { checkCliStatus, claudeBin, setupGuidance, type CliStatus } from "./cli.ts";
import { API_ID, configuredModels, PROVIDER_ID, providerModels, type ClaudeCodeModelInfo } from "./models.ts";
import { getActivePiSessionId, loadRecord, setActivePiSessionId } from "./sessions.ts";
import { streamClaudeCode } from "./stream.ts";

export { PROVIDER_ID } from "./models.ts";
export { configuredModels } from "./models.ts";
export { buildClaudeArgs, effortArgs } from "./cli.ts";
export { buildPrompt, buildStreamJsonInput, parseStreamJsonOutput } from "./prompt.ts";

let registeredModels: ClaudeCodeModelInfo[] = configuredModels(process.env.CLAUDE_CODE_PI_MODELS);
let lastCliStatus: CliStatus | undefined;

function registerClaudeProvider(pi: ExtensionAPI) {
	pi.registerProvider(PROVIDER_ID, {
		name: "Claude Code CLI",
		baseUrl: "cli:claude-p",
		apiKey: "claude-code-cli-no-api-key",
		api: API_ID,
		models: providerModels(registeredModels),
		streamSimple: streamClaudeCode,
	});
}

function statusLines(status?: CliStatus): string[] {
	const lines = [
		`Provider: ${PROVIDER_ID}`,
		`Claude binary: ${claudeBin()}`,
		`Active Pi session: ${getActivePiSessionId() ?? "(none)"}`,
		"Transport: local `claude -p` per model turn; Pi session maps to a Claude Code session UUID",
		"Fallbacks: none (no Anthropic SDK, HTTP API, or built-in Claude provider)",
		'Own Claude Code tools: disabled via --tools ""',
		"Thinking: --effort mapped from Pi thinking levels (minimal→low … xhigh)",
		"Images: sent as base64 blocks via --input-format stream-json",
		`Registered models: ${registeredModels.length}`,
	];

	const current = status ?? lastCliStatus;
	if (current) {
		lines.push(`CLI status: ${current.ok ? "ok" : "error"} — ${current.summary}`);
		if (current.detail) lines.push(`CLI detail: ${current.detail}`);
	} else {
		lines.push("CLI status: run /claude-code-pi status to check `claude --version`.");
	}

	lines.push("");
	for (const model of registeredModels) lines.push(`  - ${PROVIDER_ID}/${model.id} — ${model.name}`);
	lines.push("");
	lines.push("Quick test:");
	lines.push(`  pi -p --provider ${PROVIDER_ID} --model ${registeredModels[0]?.id ?? "sonnet"} "Reply with exactly OK"`);
	return lines;
}

export default function claudeCodePiExtension(pi: ExtensionAPI) {
	registeredModels = configuredModels(process.env.CLAUDE_CODE_PI_MODELS);
	registerClaudeProvider(pi);

	pi.on("session_start", async (_event: any, ctx: any) => {
		setActivePiSessionId(ctx.sessionManager.getSessionId());
		lastCliStatus = await checkCliStatus();
		if (!lastCliStatus.ok) {
			ctx.ui.notify(`claude-code-pi: ${setupGuidance(lastCliStatus.detail ?? lastCliStatus.summary)}`, "warning");
		}
	});

	pi.on("session_shutdown", async () => {
		setActivePiSessionId(undefined);
	});

	pi.registerCommand("claude-code-pi", {
		description: "Claude Code CLI provider status and setup help",
		handler: async (args: string, ctx: any) => {
			const sub = args.trim().split(/\s+/).filter(Boolean)[0] ?? "status";
			if (sub === "status") {
				lastCliStatus = await checkCliStatus();
				for (const line of statusLines(lastCliStatus)) ctx.ui.notify(line, lastCliStatus.ok ? "info" : "warning");
				const piId = getActivePiSessionId();
				if (piId) {
					const record = await loadRecord(piId);
					if (record) {
						ctx.ui.notify(
							`Mirror: pi=${record.piSessionId} claude=${record.claudeSessionId} initialized=${record.initialized} synced=${record.syncedCount} lastMode=${record.lastMode ?? "?"}`,
							"info",
						);
					} else {
						ctx.ui.notify("Mirror: no Claude Code session file yet (created on first model turn)", "info");
					}
				}
				return;
			}
			if (sub === "models") {
				for (const model of registeredModels) ctx.ui.notify(`${PROVIDER_ID}/${model.id} — ${model.name}`, "info");
				ctx.ui.notify('Override with CLAUDE_CODE_PI_MODELS="sonnet,opus,fable"', "info");
				return;
			}
			if (sub === "test") {
				ctx.ui.notify(
					`Run: pi -p --provider ${PROVIDER_ID} --model ${registeredModels[0]?.id ?? "sonnet"} "Reply with exactly OK"`,
					"info",
				);
				return;
			}
			if (sub === "help") {
				ctx.ui.notify("Usage: /claude-code-pi [status|models|test|help]", "info");
				ctx.ui.notify("Set CLAUDE_CODE_PI_BIN to override the claude executable.", "info");
				ctx.ui.notify("Set CLAUDE_CODE_PI_MODELS for comma-separated Claude Code model aliases.", "info");
				ctx.ui.notify("Pi session id maps to ~/.pi/agent/claude-code-pi/sessions/<id>.json", "info");
				return;
			}
			ctx.ui.notify(`Unknown /claude-code-pi subcommand: ${sub}. Try /claude-code-pi help`, "warning");
		},
	});
}
