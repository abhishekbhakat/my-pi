import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	buildThinkingLevelMap,
	checkCliStatus,
	claudeBin,
	detectEffortLevels,
	setupGuidance,
	type CliStatus,
} from "./cli.ts";
import { API_ID, configuredModels, PROVIDER_ID, providerModels, type ClaudeCodeModelInfo } from "./models.ts";
import {
	deleteClaudeSessionFile,
	getActivePiSessionId,
	loadRecord,
	reseedRecord,
	setActivePiSessionId,
} from "./sessions.ts";
import { clearSessionTurns } from "./rendezvous.ts";
import { streamClaudeSdk } from "./stream.ts";

export { PROVIDER_ID } from "./models.ts";
export { configuredModels } from "./models.ts";
export { buildQueryOptions } from "./queryOptions.ts";

let registeredModels: ClaudeCodeModelInfo[] = configuredModels();
let effortLevels: string[] = [];
let lastCliStatus: CliStatus | undefined;

function registerProvider(pi: ExtensionAPI) {
	pi.registerProvider(PROVIDER_ID, {
		name: "Claude Agent SDK",
		baseUrl: "sdk:claude-agent",
		apiKey: "claude-code-sdk-no-api-key",
		api: API_ID,
		models: providerModels(registeredModels, buildThinkingLevelMap(effortLevels)),
		streamSimple: ((model: any, context: any, options: any) => streamClaudeSdk(model, context, options)) as any,
	});
}

function statusLines(status?: CliStatus): string[] {
	const lines = [
		`Provider: ${PROVIDER_ID}`,
		`Claude binary: ${claudeBin()}`,
		`Active Pi session: ${getActivePiSessionId() ?? "(none)"}`,
		"Transport: @anthropic-ai/claude-agent-sdk query(), one drain per user message",
		"Tools: in-process 'pi' MCP server (mcp__pi__*); native tool_use/tool_result",
		"Execution: Pi model-issued tool calls (full pipeline; native transcript records and UI)",
		"Live thinking: includePartialMessages + thinking-display summarized",
		"Idle watchdog: CLAUDE_CODE_SDK_IDLE_MS (default 300000); resets on each SDK message",
		"Own Claude Code tools: disabled via tools: []",
		'SDK systemPrompt: custom bridge prompt + Pi system prompt, snapshot: false (CLI --system-prompt-snapshot off)',
		effortLevels.length > 0
			? `Thinking: effort levels from claude --help: ${effortLevels.join(", ")}`
			: "Thinking: effort levels not detected; SDK/CLI default used",
		`Registered models: ${registeredModels.length}`,
	];
	const current = status ?? lastCliStatus;
	if (current) {
		lines.push(`CLI status: ${current.ok ? "ok" : "error"} — ${current.summary}`);
		if (current.detail) lines.push(`CLI detail: ${current.detail}`);
	}
	for (const model of registeredModels) lines.push(`  - ${PROVIDER_ID}/${model.id}`);
	return lines;
}

export default async function claudeCodeSdkExtension(pi: ExtensionAPI) {
	registeredModels = configuredModels();
	effortLevels = detectEffortLevels();
	const status = await checkCliStatus();
	if (!status.ok) {
		pi.registerCommand("claude-code-sdk", {
			description: "Claude Agent SDK provider status (disabled: `claude` not usable)",
			handler: async (_args: string, ctx: any) => {
				for (const line of statusLines(status)) ctx.ui.notify(line, "warning");
				ctx.ui.notify(setupGuidance(status.detail ?? status.summary), "warning");
			},
		});
		return;
	}
	registerProvider(pi);

	pi.registerCommand("claude-sdk-refresh", {
		description: "Drop the mirrored Claude SDK session; next turn seeds a fresh one",
		handler: async (_args: string, ctx: any) => {
			const piId = getActivePiSessionId();
			if (!piId) {
				ctx.ui.notify("No active Pi session; nothing to refresh.", "warning");
				return;
			}
			// Abort the live drain first so it cannot recreate Claude's jsonl.
			await clearSessionTurns(piId);
			const record = await loadRecord(piId);
			if (!record?.initialized) {
				ctx.ui.notify("No seeded Claude SDK mirror yet.", "info");
				return;
			}
			const removed = await deleteClaudeSessionFile(record.claudeSessionId, record.cwd);
			const next = await reseedRecord(piId, record.cwd);
			ctx.ui.notify(
				`Dropped ${record.claudeSessionId}${removed ? ` (${removed})` : ""}. Next seed: ${next.claudeSessionId}`,
				"info",
			);
		},
	});

	pi.on("session_start", async (_event: any, ctx: any) => {
		setActivePiSessionId(ctx.sessionManager.getSessionId());
	});
	pi.on("session_shutdown", async (_event: any, ctx: any) => {
		const piId = ctx?.sessionManager?.getSessionId?.() ?? getActivePiSessionId();
		if (piId) void clearSessionTurns(piId);
		setActivePiSessionId(undefined);
	});

	pi.registerCommand("claude-code-sdk", {
		description: "Claude Agent SDK provider status",
		handler: async (args: string, ctx: any) => {
			const sub = args.trim().split(/\s+/).filter(Boolean)[0] ?? "status";
			if (sub === "status") {
				lastCliStatus = await checkCliStatus();
				for (const line of statusLines(lastCliStatus)) {
					ctx.ui.notify(line, lastCliStatus.ok ? "info" : "warning");
				}
				const piId = getActivePiSessionId();
				if (piId) {
					const record = await loadRecord(piId);
					if (record) {
						ctx.ui.notify(
							`Mirror: pi=${record.piSessionId} claude=${record.claudeSessionId} initialized=${record.initialized} synced=${record.syncedCount}`,
							"info",
						);
					}
				}
				return;
			}
			if (sub === "models") {
				for (const model of registeredModels) ctx.ui.notify(`${PROVIDER_ID}/${model.id}`, "info");
				return;
			}
			if (sub === "help") {
				ctx.ui.notify("Usage: /claude-code-sdk [status|models|help]", "info");
				ctx.ui.notify("Models: claude-code-sdk/haiku|sonnet|opus", "info");
				ctx.ui.notify("Idle: CLAUDE_CODE_SDK_IDLE_MS (default 300000)", "info");
				return;
			}
			ctx.ui.notify(`Unknown subcommand: ${sub}`, "warning");
		},
	});
}