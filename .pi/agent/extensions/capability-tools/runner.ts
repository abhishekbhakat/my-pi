import { stream as piAiStream } from "@earendil-works/pi-ai";
import type { AgentToolUpdateCallback } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildCapabilityContext, buildCapabilityPrompt } from "./context";
import { appendCapabilityHistory } from "./history";
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

/** True when the whole answer is fake tool markup, not a prose mention of the tag. */
function isHallucinatedToolAnswer(text: string): boolean {
	const trimmed = text.trim();
	if (!trimmed) return false;
	if (/^(?:\s*<pi_tool_call>[\s\S]*?<\/pi_tool_call>\s*)+$/.test(trimmed)) return true;
	if (!trimmed.includes("<pi_tool_call>")) return false;
	const without = trimmed.replace(/<pi_tool_call>[\s\S]*?<\/pi_tool_call>/g, "").trim();
	return without.length < 40;
}

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

	onUpdate?.({
		content: [{ type: "text", text: `Assembling context for ${def.label}...` }],
		details: { status: "assembling", capability: def.toolName },
	});

	const context = await buildCapabilityContext(pi, ctx, def, input, signal);
	const prompt = buildCapabilityPrompt(input.task, context);

	const fast = fastWireState();
	const serviceTier = model.provider === "openai-codex" && fast?.enabled ? "priority" : undefined;
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
		"PLAIN TEXT ONLY. Do not emit function calls, tool calls, XML tool tags, or <pi_tool_call> blocks.\n\n";

	try {
		// Route through composed provider so custom extension APIs
		// (e.g. claude-code-cli-runner) resolve. Fall back to pi-ai
		// direct stream only when provider missing.
		const provider = ctx.modelRegistry.getProvider(model.provider);
		const requestOptions = {
			apiKey: auth.apiKey,
			headers: auth.headers,
			signal,
			reasoningEffort: model.reasoning ? def.reasoningEffort : undefined,
			serviceTier,
			toolChoice: "none" as const,
			metadata: { capability: def.toolName },
		};

		const runOnce = async (userPrompt: string) => {
			const requestContext = {
				systemPrompt: def.systemPrompt,
				tools: [] as [],
				messages: [
					{
						role: "user" as const,
						content: [{ type: "text" as const, text: userPrompt }],
						timestamp: Date.now(),
					},
				],
			};
			const eventStream = provider
				? provider.stream(model, requestContext, requestOptions)
				: piAiStream(model, requestContext, requestOptions);

			// Drain stream so result() can settle. UI shows a 2-line live preview
			// from text, or thinking while the model is still reasoning.
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
				// Throttle UI updates; always allow the first preview through.
				if (lastPreview && now - lastPublish < 120) continue;
				lastPublish = now;
				lastPreview = preview;

				onUpdate?.({
					content: [{ type: "text", text: preview }],
					details: {
						status: "streaming",
						streamKind: source.kind,
						capability: def.toolName,
						paths: context.autoPaths,
						promptChars: userPrompt.length,
					},
				});
			}

			return await eventStream.result();
		};

		let response: Awaited<ReturnType<typeof runOnce>> | undefined;
		let text = "";
		let userPrompt = prompt;
		let attempt = 0;

		while (attempt < 2) {
			try {
				response = await runOnce(userPrompt);
				text = extractText(response);
			} catch (error) {
				const message = error instanceof Error ? error.message : "Capability call failed";
				if (attempt === 0 && !signal?.aborted && isThrownToolish(message)) {
					attempt = 1;
					userPrompt = TEXT_ONLY_REMINDER + prompt;
					onUpdate?.({
						content: [{ type: "text", text: `${def.label}: tool-call throw, retrying once as plain text...` }],
						details: { status: "running", capability: def.toolName, paths: context.autoPaths },
					});
					continue;
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

			if (attempt === 0 && isToolishFailure(response, text) && !signal?.aborted) {
				attempt = 1;
				userPrompt = TEXT_ONLY_REMINDER + prompt;
				onUpdate?.({
					content: [{ type: "text", text: `${def.label}: tool-call failure, retrying once as plain text...` }],
					details: { status: "running", capability: def.toolName, paths: context.autoPaths },
				});
				continue;
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

		const sessionId = ctx.sessionManager.getSessionId();
		if (text) {
			// A history write failure must not replace a good answer.
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
