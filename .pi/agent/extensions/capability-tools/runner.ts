import { complete } from "@mariozechner/pi-ai";
import type { AgentToolUpdateCallback } from "@mariozechner/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
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

function extractText(response: { content?: Array<{ type: string; text?: string }> }): string {
	return (response.content ?? [])
		.filter((item): item is { type: "text"; text: string } => item.type === "text" && typeof item.text === "string")
		.map((item) => item.text)
		.join("\n")
		.trim();
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
		content: [{ type: "text", text: `Calling ${def.model} for ${def.label}...` }],
		details: { status: "running", capability: def.toolName, paths: context.autoPaths },
	});

	try {
		const response = await complete(
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

		const text = extractText(response);
		return {
			content: [{ type: "text", text: text || `[${def.label}] Empty response.` }],
			details: {
				status: "done",
				capability: def.toolName,
				model: `${model.provider}/${model.id}`,
				paths: context.autoPaths,
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
			},
		};
	}
}
