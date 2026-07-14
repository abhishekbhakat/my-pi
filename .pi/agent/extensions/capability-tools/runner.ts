import { stream } from "@earendil-works/pi-ai";
import type { AgentToolUpdateCallback } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildCapabilityContext, buildCapabilityPrompt } from "./context";
import type { CapabilityDef, CapabilityToolInput } from "./types";

function splitModelRef(modelRef: string): { provider: string; modelId: string } | null {
	const index = modelRef.indexOf("/");
	if (index <= 0) return null;
	return {
		provider: modelRef.slice(0, index),
		modelId: modelRef.slice(index + 1),
	};
}

function extractText(response: {
	content?: Array<{ type: string; text?: string; thinking?: string }>;
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

function formatStreamingPreview(source: PartialStreamSource): string {
	if (source.kind === "text") {
		return streamingPreview(source.text, 2);
	}
	// Keep total height to 2 lines: label + latest thinking line.
	const latest = streamingPreview(source.text, 1);
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

	if (!auth.apiKey) {
		return {
			content: [{ type: "text", text: `No API key available for ${def.model}` }],
			details: { status: "error", capability: def.toolName },
		};
	}

	onUpdate?.({
		content: [{ type: "text", text: `Assembling context for ${def.label}...` }],
		details: { status: "assembling", capability: def.toolName },
	});

	const context = await buildCapabilityContext(pi, ctx, def, input, signal);
	const prompt = buildCapabilityPrompt(input.task, context);

	onUpdate?.({
		content: [{
			type: "text",
			text: `Calling ${def.model} for ${def.label}... (${prompt.length.toLocaleString()} prompt chars, ${context.autoPaths.length} paths)`,
		}],
		details: {
			status: "running",
			capability: def.toolName,
			paths: context.autoPaths,
			promptChars: prompt.length,
		},
	});

	try {
		const eventStream = stream(
			model,
			{
				systemPrompt: def.systemPrompt,
				messages: [
					{
						role: "user",
						content: [{ type: "text", text: prompt }],
						timestamp: Date.now(),
					},
				],
			},
			{
				apiKey: auth.apiKey,
				headers: auth.headers,
				signal,
				reasoningEffort: model.reasoning ? def.reasoningEffort : undefined,
			},
		);

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

			const preview = formatStreamingPreview(source);
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
					promptChars: prompt.length,
				},
			});
		}

		const response = await eventStream.result();
		const text = extractText(response);

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

		if (response.stopReason === "error") {
			return {
				content: [{ type: "text", text: text || `${def.label} failed.` }],
				details: {
					status: "error",
					capability: def.toolName,
					model: `${model.provider}/${model.id}`,
					paths: context.autoPaths,
					promptChars: prompt.length,
				},
			};
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
			content: [{ type: "text", text: `${def.label} failed: ${message}` }],
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
