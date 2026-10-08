import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildThinkingLevelMap, checkCliStatus, claudeBin, detectEffortLevels, setupGuidance, type CliStatus } from "./cli.ts";
import { API_ID, configuredModels, PROVIDER_ID, providerModels, type ClaudeCodeModelInfo } from "./models.ts";
import { morphStatus, type MorphStatus } from "./morphRepair.ts";
import { deleteClaudeSessionFile, getActivePiSessionId, loadRecord, reseedRecord, setActivePiSessionId } from "./sessions.ts";
import { streamClaudeCode } from "./stream.ts";

export { PROVIDER_ID } from "./models.ts";
export { configuredModels } from "./models.ts";
export { buildClaudeArgs, effortArgs } from "./cli.ts";
export { buildPrompt, buildStreamJsonInput, parseStreamJsonOutput } from "./prompt.ts";

let registeredModels: ClaudeCodeModelInfo[] = configuredModels(process.env.CLAUDE_CODE_PI_MODELS);
let effortLevels: string[] = [];
let lastCliStatus: CliStatus | undefined;
let lastMorphStatus: MorphStatus | undefined;

function registerClaudeProvider(pi: ExtensionAPI) {
	pi.registerProvider(PROVIDER_ID, {
		name: "Claude Code CLI",
		baseUrl: "cli:claude-p",
		apiKey: "claude-code-cli-no-api-key",
		api: API_ID,
		models: providerModels(registeredModels, buildThinkingLevelMap(effortLevels)),
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
		effortLevels.length > 0
			? `Thinking: --effort levels from claude --help: ${effortLevels.join(", ")}`
			: "Thinking: --effort levels not detected; CLI default effort used",
		"Images: sent as base64 blocks via --input-format stream-json",
		`Registered models: ${registeredModels.length}`,
		lastMorphStatus?.summary
			?? "Morph repair: run /claude-code-pi status (needs OpenRouter key when on)",
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

export default async function claudeCodePiExtension(pi: ExtensionAPI) {
	registeredModels = configuredModels(process.env.CLAUDE_CODE_PI_MODELS);
	effortLevels = detectEffortLevels();
	const status = await checkCliStatus();
	lastCliStatus = status;
	lastMorphStatus = await morphStatus();
	if (!status.ok) {
		// CLI missing or unusable: register no provider so this extension stays inert.
		pi.registerCommand("claude-code-pi", {
			description: "Claude Code CLI provider status and setup help (provider disabled: `claude` not usable)",
			handler: async (_args: string, ctx: any) => {
				for (const line of statusLines(status)) ctx.ui.notify(line, "warning");
				ctx.ui.notify(setupGuidance(status.detail ?? status.summary), "warning");
			},
		});
		return;
	}
	registerClaudeProvider(pi);

	pi.registerCommand("claude-refresh", {
		description: "Drop the mirrored Claude Code session; next model turn seeds a fresh one",
		handler: async (_args: string, ctx: any) => {
			const piId = getActivePiSessionId();
			if (!piId) {
				ctx.ui.notify("No active Pi session; nothing to refresh.", "warning");
				return;
			}
			const record = await loadRecord(piId);
			if (!record) {
				ctx.ui.notify("No Claude Code mirror for this session yet; the next turn seeds one anyway.", "info");
				return;
			}
			if (!record.initialized) {
				ctx.ui.notify("Mirror never seeded; the next turn already starts a fresh Claude session.", "info");
				return;
			}
			const removed = await deleteClaudeSessionFile(record.claudeSessionId, record.cwd);
			const next = await reseedRecord(piId, record.cwd);
			ctx.ui.notify(
				`Dropped Claude Code session ${record.claudeSessionId}${removed ? ` and deleted its transcript (${removed})` : " (no transcript file found)"}. Next model turn seeds session ${next.claudeSessionId} with the full Pi transcript.`,
				"info",
			);
		},
	});

	pi.on("session_start", async (_event: any, ctx: any) => {
		setActivePiSessionId(ctx.sessionManager.getSessionId());
		if (lastMorphStatus?.enabled && !lastMorphStatus.ready) {
			ctx.ui.notify(lastMorphStatus.summary, "warning");
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
				lastMorphStatus = await morphStatus();
				const level = lastCliStatus.ok && lastMorphStatus.ready ? "info" : "warning";
				for (const line of statusLines(lastCliStatus)) ctx.ui.notify(line, level);
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
				ctx.ui.notify("Morph repair: OpenRouter key fixes broken Claude tool XML so Pi can run tools (make setup asks when enabling claude-code-cli).", "info");
				ctx.ui.notify("Pi session id maps to ~/.pi/agent/claude-code-pi/sessions/<id>.json", "info");
				ctx.ui.notify("Run /claude-refresh to drop the mirrored Claude Code session and seed a fresh one next turn.", "info");
				return;
			}
			ctx.ui.notify(`Unknown /claude-code-pi subcommand: ${sub}. Try /claude-code-pi help`, "warning");
		},
	});
}
