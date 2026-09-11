import { GoogleGenAI } from "@google/genai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveConfigApiKey } from "./config";
import { extractJsonObject } from "./parse";
import { buildClassifyPrompt, DECISION_JSON_SCHEMA } from "./prompt";
import { DEFAULT_GEMINI_MODEL, type ClassifierRef } from "./types";

async function resolveGeminiKey(ctx: ExtensionContext, classifier: ClassifierRef): Promise<string> {
	const configApiKey = resolveConfigApiKey(classifier.apiKey);
	if (configApiKey) return configApiKey;
	const auth = await ctx.modelRegistry.getProviderAuth(classifier.provider || "google");
	const piKey = auth?.auth.apiKey;
	if (piKey) return piKey;
	throw new Error(`no API key for classifier ${classifier.provider}/${classifier.id}`);
}

function geminiModelId(id: string): string {
	const trimmed = id.trim() || DEFAULT_GEMINI_MODEL;
	return trimmed.startsWith("models/") ? trimmed.slice("models/".length) : trimmed;
}

export async function classifyGemini(
	ctx: ExtensionContext,
	classifier: ClassifierRef,
	prompt: string,
	lastAssistant: string | undefined,
	signal?: AbortSignal,
): Promise<unknown> {
	const apiKey = await resolveGeminiKey(ctx, classifier);
	const ai = new GoogleGenAI({ apiKey });
	const response = await ai.models.generateContent({
		model: geminiModelId(classifier.id),
		contents: prompt,
		config: {
			systemInstruction: buildClassifyPrompt(lastAssistant),
			responseMimeType: "application/json",
			responseJsonSchema: DECISION_JSON_SCHEMA,
			temperature: 0,
			maxOutputTokens: classifier.maxTokens ?? 1024,
			thinkingConfig: {
				thinkingLevel: (classifier.thinkingLevel || "medium").toUpperCase(),
			},
			abortSignal: signal,
		},
	});
	const text = response.text?.trim();
	if (!text) throw new Error("gemini classifier returned empty content");
	return extractJsonObject(text);
}
