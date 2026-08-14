import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveConfigApiKey } from "./config";
import { extractJsonObject } from "./parse";
import { buildClassifyPrompt } from "./prompt";
import { DEFAULT_CLASSIFIER_BASE_URL, isRecord, type ClassifierRef, type ToolInfo } from "./types";

async function resolveOpenRouterRequest(
	ctx: ExtensionContext,
	classifier: ClassifierRef,
): Promise<{ baseUrl: string; apiKey: string; model: string }> {
	const configApiKey = resolveConfigApiKey(classifier.apiKey);
	if (configApiKey) {
		return {
			baseUrl: (classifier.baseUrl || DEFAULT_CLASSIFIER_BASE_URL).replace(/\/$/, ""),
			apiKey: configApiKey,
			model: classifier.id,
		};
	}
	const auth = await ctx.modelRegistry.getProviderAuth(classifier.provider);
	const piKey = auth?.auth.apiKey;
	if (!piKey) {
		throw new Error(`no API key for classifier ${classifier.provider}/${classifier.id}`);
	}
	return {
		baseUrl: (classifier.baseUrl || auth.auth.baseUrl || DEFAULT_CLASSIFIER_BASE_URL).replace(/\/$/, ""),
		apiKey: piKey,
		model: classifier.id,
	};
}

function classifierReplyText(payload: unknown): string {
	if (!isRecord(payload)) throw new Error("classifier response is not JSON");
	if (typeof payload.error === "string") throw new Error(payload.error);
	if (isRecord(payload.error) && typeof payload.error.message === "string") {
		throw new Error(payload.error.message);
	}
	const choices = payload.choices;
	if (!Array.isArray(choices) || !isRecord(choices[0])) {
		throw new Error("classifier returned no choices");
	}
	const message = isRecord(choices[0].message) ? choices[0].message : undefined;
	const content = message?.content;
	if (typeof content === "string" && content.trim()) return content;
	if (Array.isArray(content)) {
		const text = content
			.filter((part): part is Record<string, unknown> => isRecord(part))
			.map((part) => {
				if (typeof part.text === "string") return part.text;
				if (typeof part.content === "string") return part.content;
				return "";
			})
			.join("\n")
			.trim();
		if (text) return text;
	}
	const reasoning =
		(typeof message?.reasoning === "string" && message.reasoning) ||
		(typeof message?.reasoning_content === "string" && message.reasoning_content) ||
		"";
	if (reasoning.trim()) return reasoning;
	throw new Error("classifier returned empty content");
}

export async function classifyOpenRouter(
	ctx: ExtensionContext,
	classifier: ClassifierRef,
	prompt: string,
	tools: ToolInfo[],
	lastAssistant: string | undefined,
	signal?: AbortSignal,
): Promise<unknown> {
	const request = await resolveOpenRouterRequest(ctx, classifier);
	const response = await fetch(`${request.baseUrl}/chat/completions`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${request.apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model: request.model,
			temperature: 0,
			max_tokens: classifier.maxTokens ?? 1024,
			response_format: { type: "json_object" },
			messages: [
				{ role: "system", content: buildClassifyPrompt(tools, lastAssistant) },
				{ role: "user", content: prompt },
			],
		}),
		signal,
	});
	const body = await response.text();
	let payload: unknown = body;
	try {
		payload = JSON.parse(body);
	} catch {
		throw new Error(response.ok ? "classifier returned non-JSON" : `classifier HTTP ${response.status}`);
	}
	if (!response.ok) {
		const err = isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === "string"
			? payload.error.message
			: `classifier HTTP ${response.status}`;
		throw new Error(err);
	}
	return extractJsonObject(classifierReplyText(payload));
}
