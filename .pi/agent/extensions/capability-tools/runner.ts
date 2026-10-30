import * as path from "node:path";
import { stream as piAiStream, type Message, type Tool, type ToolCall } from "@earendil-works/pi-ai";
import type { AgentToolUpdateCallback } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { cleanCommitMessage, NO_STAGED_CHANGES_MESSAGE } from "./commitMessage";
import { buildCapabilityContext, buildCapabilityPrompt } from "./context";
import { appendCapabilityHistory } from "./history";
import { isRefusalPreamble } from "./refusal";
import { classifyScoutPaths, formatMissingScoutPaths, formatNoFilesRead } from "./scoutPaths";
import { buildScoutTools, executeScoutTool } from "./scoutTools";
import { isHallucinatedToolAnswer } from "./toolish";
import type { CapabilityDef, CapabilityToolInput } from "./types";

function splitModelRef(modelRef: string): { provider: string; modelId: string } | null {
	const index = modelRef.indexOf("/");
	if (index <= 0) return null;
	return {
		provider: modelRef.slice(0, index),
		modelId: modelRef.slice(index + 1),
	};
}

const FAST_WRAP_KEY = Symbol.for("my-pi.fast-mode.wrap.v2");

type FastWireState = { enabled?: boolean; remember?: (provider: string, id: string) => void };

function fastWireState(): FastWireState | undefined {
	return (globalThis as typeof globalThis & { [FAST_WRAP_KEY]?: FastWireState })[FAST_WRAP_KEY];
}

function extractText(response: {
	content?: Array<{ type: string; text?: string; thinking?: string; name?: string; arguments?: unknown }>;
	stopReason?: string;
	errorMessage?: string;
}): string {
	const parts = response.content ?? [];
	const text = parts
		.filter((item): item is { type: "text"; text: string } => item.type === "text" && typeof item.text === "string")
		.map((item) => item.text)
		.join("\n")
		.trim();

	if (text) return text;

	// Text-only helpers sometimes hallucinate toolCall parts. Surface intent instead of empty.
	const toolBits = parts
		.filter((item) => item.type === "toolCall")
		.map((item) => {
			const name = typeof item.name === "string" ? item.name : "unknown";
			const args =
				item.arguments !== undefined ? JSON.stringify(item.arguments).slice(0, 200) : "{}";
			return `${name} ${args}`;
		});
	if (toolBits.length > 0) {
		return (
			`Helper attempted unavailable tool calls: ${toolBits.join("; ")}. ` +
			"Proceed with read/grep/find; do not retry this helper blindly."
		);
	}

	// Prefer provider/error status over partial thinking so failures are not masked.
	if (response.errorMessage) return response.errorMessage;
	if (response.stopReason === "error" || response.stopReason === "aborted") {
		return `Empty response (stopReason: ${response.stopReason}).`;
	}
	if (response.stopReason && response.stopReason !== "stop") {
		return `Empty response (stopReason: ${response.stopReason}).`;
	}

	// Successful completion with no text: some reasoning models only emit thinking.
	const thinking = parts
		.filter((item): item is { type: "thinking"; thinking: string } =>
			item.type === "thinking" && typeof item.thinking === "string" && item.thinking.trim().length > 0
		)
		.map((item) => item.thinking.trim())
		.join("\n\n")
		.trim();

	if (thinking) {
		return thinking.length > 6000
			? `${thinking.slice(0, 6000)}\n\n[thinking truncated; no text content returned]`
			: thinking;
	}

	return "";
}

const TOOLISH_PROVIDER_RE = /MALFORMED_FUNCTION_CALL|UNEXPECTED_TOOL_CALL|TOO_MANY_TOOL_CALLS/i;
const FALLBACK_NO_RETRY =
	"Proceed with read/grep/find; do not retry this helper blindly.";

function isThrownToolish(message: string): boolean {
	return TOOLISH_PROVIDER_RE.test(message);
}

function isToolishFailure(response: {
	content?: Array<{ type: string }>;
	stopReason?: string;
	errorMessage?: string;
}, text: string): boolean {
	if (response.stopReason === "toolUse") return true;
	if (TOOLISH_PROVIDER_RE.test(response.errorMessage ?? "")) return true;
	if ((response.content ?? []).some((part) => part.type === "toolCall")) return true;
	return isHallucinatedToolAnswer(text);
}

function withNoRetryGuidance(text: string, label: string): string {
	const base = text.trim() || `${label} failed (tool-call hallucination).`;
	if (base.includes("do not retry this helper blindly")) return base;
	return `${base} ${FALLBACK_NO_RETRY}`;
}

type PartialStreamSource = {
	kind: "text" | "thinking";
	text: string;
};

/**
 * Prefer final answer text; fall back to thinking for reasoning models that
 * stream thinking_delta long before any text content appears.
 */
function extractPartialStreamSource(partial: {
	content?: Array<{ type: string; text?: string; thinking?: string }>;
}): PartialStreamSource | null {
	const parts = partial.content ?? [];

	const text = parts
		.filter((item): item is { type: "text"; text: string } => item.type === "text" && typeof item.text === "string")
		.map((item) => item.text)
		.join("");
	if (text.trim()) return { kind: "text", text };

	const thinking = parts
		.filter((item): item is { type: "thinking"; thinking: string } =>
			item.type === "thinking" && typeof item.thinking === "string"
		)
		.map((item) => item.thinking)
		.join("");
	if (thinking.trim()) return { kind: "thinking", text: thinking };

	return null;
}

/** Keep the growing tail of a long line so the preview keeps moving. */
function rollingLineTail(line: string, maxLineChars: number): string {
	if (line.length <= maxLineChars) return line;
	return `…${line.slice(-(maxLineChars - 1))}`;
}

/** Compact live preview for tool-call UI (last N lines only). */
function streamingPreview(text: string, maxLines = 2, maxLineChars = 140): string {
	const lines = text.replace(/\r\n/g, "\n").split("\n").filter((line) => line.length > 0);
	return lines
		.slice(-maxLines)
		.map((line) => rollingLineTail(line, maxLineChars))
		.join("\n");
}

function formatStreamingPreview(source: PartialStreamSource, maxLines = 2): string {
	const lines = Math.max(1, maxLines);
	if (source.kind === "text") {
		return streamingPreview(source.text, lines);
	}
	const latest = streamingPreview(source.text, Math.max(1, lines - 1));
	return latest ? `thinking…\n${latest}` : "thinking…";
}

export async function executeCapability(
	pi: ExtensionAPI,
	def: CapabilityDef,
	input: CapabilityToolInput,
	signal: AbortSignal | undefined,
	onUpdate: AgentToolUpdateCallback | undefined,
	ctx: ExtensionContext,
) {
	const modelRef = splitModelRef(def.model);
	if (!modelRef) {
		return {
			content: [{ type: "text", text: `Invalid model reference for ${def.toolName}: ${def.model}` }],
			details: { status: "error", capability: def.toolName },
		};
	}

	const model = ctx.modelRegistry.find(modelRef.provider, modelRef.modelId);
	if (!model) {
		return {
			content: [{ type: "text", text: `Model not found for ${def.toolName}: ${def.model}` }],
			details: { status: "error", capability: def.toolName },
		};
	}

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok) {
		return {
			content: [{ type: "text", text: auth.error }],
			details: { status: "error", capability: def.toolName },
		};
	}

	if (!auth.apiKey && !auth.headers) {
		return {
			content: [{ type: "text", text: `No API key or headers available for ${def.model}` }],
			details: { status: "error", capability: def.toolName },
		};
	}

	if (def.toolName === "code_scout") {
		const classified = await classifyScoutPaths(ctx.cwd, input.paths ?? []);
		if (classified.requested > 0 && classified.found.length === 0) {
			return {
				content: [{ type: "text", text: formatMissingScoutPaths(ctx.cwd, classified.missing) }],
				details: {
					status: "error",
					capability: def.toolName,
					paths: classified.missing,
				},
			};
		}
	}

	onUpdate?.({
		content: [{ type: "text", text: `Assembling context for ${def.label}...` }],
		details: { status: "assembling", capability: def.toolName },
	});

	const context = await buildCapabilityContext(pi, ctx, def, input, signal);
	if (def.toolName === "commit_message" && context.stagedEmpty) {
		return {
			content: [{ type: "text", text: NO_STAGED_CHANGES_MESSAGE }],
			details: {
				status: "done",
				capability: def.toolName,
				paths: context.autoPaths,
			},
		};
	}
	const prompt = buildCapabilityPrompt(input.task, context);

	const fast = fastWireState();
	const serviceTier = (model.provider === "openai" || model.provider === "openai-codex") && fast?.enabled ? "priority" : undefined;
	fast?.remember?.(model.provider, model.id);

	onUpdate?.({
		content: [{
			type: "text",
			text: `Calling ${def.model} for ${def.label}... (${prompt.length.toLocaleString()} prompt chars, ${context.autoPaths.length} paths${serviceTier ? `, ${serviceTier}` : ""})`,
		}],
		details: {
			status: "running",
			capability: def.toolName,
			paths: context.autoPaths,
			promptChars: prompt.length,
			serviceTier,
		},
	});

	const TEXT_ONLY_REMINDER =
		"PLAIN TEXT ONLY. Do not emit function calls, tool calls, DSML, XML tool tags, or <pi_tool_call> blocks.\n\n";

	try {
		const provider = ctx.modelRegistry.getProvider(model.provider);
		const scoutToolDefs = buildScoutTools(def.scoutTools ?? []);
		const scoutEnabled = scoutToolDefs.length > 0;
		const maxRounds = scoutEnabled ? (def.maxToolRounds ?? 300) : 1;
		const scoutRoots = [
			ctx.cwd,
			...(input.paths ?? []).map((item) => path.resolve(ctx.cwd, item)),
		];

		const streamTurn = async (
			messages: Message[],
			tools: Tool[],
			toolChoice: "auto" | "none",
			capabilityTools: boolean,
			roundLabel: string,
		) => {
			const requestOptions = {
				apiKey: auth.apiKey,
				headers: auth.headers,
				signal,
				reasoningEffort: model.reasoning ? def.reasoningEffort : undefined,
				serviceTier,
				toolChoice,
				metadata: {
					capability: def.toolName,
					capabilityTools,
				},
			};
			const requestContext = {
				systemPrompt: def.systemPrompt,
				tools,
				messages,
			};
			const eventStream = provider
				? provider.stream(model, requestContext, requestOptions)
				: piAiStream(model, requestContext, requestOptions);

			let lastPublish = 0;
			let lastPreview = "";
			for await (const event of eventStream) {
				if (signal?.aborted) break;
				const partial = "partial" in event ? event.partial : undefined;
				if (!partial) continue;
				const source = extractPartialStreamSource(partial);
				if (!source) continue;
				const preview = formatStreamingPreview(source, input.previewLines ?? 2);
				if (!preview || preview === lastPreview) continue;
				const now = Date.now();
				if (lastPreview && now - lastPublish < 120) continue;
				lastPublish = now;
				lastPreview = preview;
				onUpdate?.({
					content: [{ type: "text", text: `${roundLabel}${preview}` }],
					details: {
						status: "streaming",
						streamKind: source.kind,
						capability: def.toolName,
						paths: context.autoPaths,
					},
				});
			}
			return await eventStream.result();
		};

		let messages: Message[] = [
			{
				role: "user",
				content: [{ type: "text", text: prompt }],
				timestamp: Date.now(),
			},
		];
		let response: Awaited<ReturnType<typeof streamTurn>> | undefined;
		let text = "";
		let refusalRetried = false;
		let toolRounds = 0;
		let toolCalls = 0;
		let totalToolChars = 0;
		const MAX_TOOL_CHARS = 60_000;
		const MAX_CALLS_PER_ROUND = 4;

		for (let round = 0; round < maxRounds; round++) {
			const lastRound = round >= maxRounds - 1 || totalToolChars >= MAX_TOOL_CHARS;
			const tools = scoutEnabled && !lastRound ? scoutToolDefs : [];
			const toolChoice = tools.length > 0 ? "auto" : "none";
			const roundLabel = scoutEnabled ? `round ${round + 1}/${maxRounds} · ` : "";

			try {
				response = await streamTurn(messages, tools, toolChoice, tools.length > 0, roundLabel);
			} catch (error) {
				const message = error instanceof Error ? error.message : "Capability call failed";
				if (tools.length === 0 && !signal?.aborted && isThrownToolish(message)) {
					messages = [
						{
							role: "user",
							content: [{ type: "text", text: TEXT_ONLY_REMINDER + prompt }],
							timestamp: Date.now(),
						},
					];
					response = await streamTurn(messages, [], "none", false, roundLabel);
					text = extractText(response);
					break;
				}
				return {
					content: [{
						type: "text",
						text: withNoRetryGuidance(`${def.label} failed: ${message}`, def.label),
					}],
					details: {
						status: "error",
						capability: def.toolName,
						model: `${model.provider}/${model.id}`,
						paths: context.autoPaths,
						promptChars: prompt.length,
					},
				};
			}

			const calls = (response.content ?? []).filter(
				(part): part is ToolCall => part.type === "toolCall",
			);
			const expectTools = tools.length > 0;

			if (response.stopReason === "toolUse" && expectTools && calls.length > 0 && !lastRound) {
				messages = [...messages, response];
				toolRounds += 1;
				for (const [index, call] of calls.entries()) {
					const canExecute = index < MAX_CALLS_PER_ROUND && totalToolChars < MAX_TOOL_CHARS;
					const result = canExecute
						? await executeScoutTool(
							call.name,
							(call.arguments ?? {}) as Record<string, unknown>,
							{ cwd: ctx.cwd, roots: scoutRoots },
						)
						: { text: "Read budget reached. Use existing results or request remaining files in a later round.", isError: true };
					if (canExecute) toolCalls += 1;
					totalToolChars += result.text.length;
					messages.push({
						role: "toolResult",
						toolCallId: call.id,
						toolName: call.name,
						content: [{ type: "text", text: result.text }],
						isError: result.isError,
						timestamp: Date.now(),
					});
				}
				if (totalToolChars >= MAX_TOOL_CHARS || round + 1 >= maxRounds - 1) {
					messages.push({
						role: "user",
						content: [{
							type: "text",
							text: "Tool budget spent. Write the report now from Path Context and tool results. Start with ## Relevant Files.",
						}],
						timestamp: Date.now(),
					});
				}
				continue;
			}

			text = extractText(response);

			// Tool markup written as text was never executed, even when native tools were offered.
			if (isToolishFailure(response, text) && !signal?.aborted) {
				messages = [...messages, {
					role: "user",
					content: [{ type: "text", text: TEXT_ONLY_REMINDER +
						"Previous tool markup was not executed. No tools are available now. Use Path Context and completed tool results above. " +
						(def.toolName === "code_scout" ? "Write the report now, starting with ## Relevant Files. List missing files under Unknowns." : "Answer the task now.") }],
					timestamp: Date.now(),
				}];
				response = await streamTurn(messages, [], "none", false, roundLabel);
				text = extractText(response);
			}

			if (
				def.refusalRetry &&
				!refusalRetried &&
				!signal?.aborted &&
				(context.pathCodeFiles ?? 0) > 0 &&
				isRefusalPreamble(text)
			) {
				refusalRetried = true;
				messages = [
					{
						role: "user",
						content: [{
							type: "text",
							text:
								'Your previous reply claimed you cannot read the code. That is wrong: Path Context below contains the file contents. Produce the report from them now, starting with "## Relevant Files".\n\n' +
								prompt,
						}],
						timestamp: Date.now(),
					},
				];
				response = await streamTurn(messages, [], "none", false, roundLabel);
				text = extractText(response);
			}
			break;
		}

		if (!response) {
			return {
				content: [{ type: "text", text: withNoRetryGuidance(`${def.label} failed.`, def.label) }],
				details: {
					status: "error",
					capability: def.toolName,
					model: `${model.provider}/${model.id}`,
					paths: context.autoPaths,
					promptChars: prompt.length,
				},
			};
		}

		if (response.stopReason === "aborted") {
			return {
				content: [{ type: "text", text: text || `${def.label} aborted.` }],
				details: {
					status: "aborted",
					capability: def.toolName,
					model: `${model.provider}/${model.id}`,
					paths: context.autoPaths,
					promptChars: prompt.length,
				},
			};
		}

		const toolish = isToolishFailure(response, text);
		if (response.stopReason === "error" || toolish) {
			const failureText = toolish
				? withNoRetryGuidance(text, def.label)
				: text || `${def.label} failed.`;
			return {
				content: [{ type: "text", text: failureText }],
				details: {
					status: "error",
					capability: def.toolName,
					model: `${model.provider}/${model.id}`,
					paths: context.autoPaths,
					promptChars: prompt.length,
					stopReason: response.stopReason,
				},
			};
		}

		if (def.toolName === "code_scout" && (context.pathCodeFiles ?? 0) === 0 && toolCalls === 0) {
			return {
				content: [{ type: "text", text: formatNoFilesRead(ctx.cwd, context.autoPaths) }],
				details: {
					status: "error",
					capability: def.toolName,
					model: `${model.provider}/${model.id}`,
					paths: context.autoPaths,
					promptChars: prompt.length,
					pathCodeFiles: 0,
					toolRounds,
					toolCalls,
				},
			};
		}

		const sessionId = ctx.sessionManager.getSessionId();
		if (def.toolName === "commit_message" && text) {
			const cleaned = cleanCommitMessage(text);
			if (cleaned) text = cleaned;
			else if (text.trim() !== NO_STAGED_CHANGES_MESSAGE && !text.trim().startsWith("No staged changes found.")) {
				text = "commit_message produced no usable conventional commit line. Retry the tool.";
			}
		}
		if (text) {
			await appendCapabilityHistory(sessionId, def.toolName, input.task, text).catch(() => undefined);
		}

		return {
			content: [{ type: "text", text: text || `[${def.label}] Empty response.` }],
			details: {
				status: "done",
				capability: def.toolName,
				model: `${model.provider}/${model.id}`,
				paths: context.autoPaths,
				promptChars: prompt.length,
				stopReason: response.stopReason,
				pathCodeFiles: context.pathCodeFiles ?? 0,
				expandedFiles: context.expandedFiles ?? [],
				refusalRetried,
				toolRounds,
				toolCalls,
			},
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : "Capability call failed";
		return {
			content: [{ type: "text", text: withNoRetryGuidance(`${def.label} failed: ${message}`, def.label) }],
			details: {
				status: "error",
				capability: def.toolName,
				model: `${model.provider}/${model.id}`,
				paths: context.autoPaths,
				promptChars: prompt.length,
			},
		};
	}
}
