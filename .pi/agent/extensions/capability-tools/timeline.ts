import { createHash } from "node:crypto";
import { complete } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CapabilityDef } from "./types";

const TIMELINE_CACHE_LIMIT = 24;
const timelineCache = new Map<string, string>();

const TIMELINE_SYSTEM_PROMPT = [
	"You write compact action timelines for coding helper tools.",
	"Use only facts present in the conversation.",
	"Capture user requests, explored files or ideas, decisions, edits, rules, and the current unresolved task.",
	"Return 4 to 8 numbered items. No intro. No speculation.",
].join("\n");

function truncateHead(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars)}\n\n[truncated ${text.length - maxChars} chars]`;
}

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

function hashText(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

function setTimelineCache(key: string, value: string): void {
	if (timelineCache.size >= TIMELINE_CACHE_LIMIT) {
		const firstKey = timelineCache.keys().next().value;
		if (firstKey) timelineCache.delete(firstKey);
	}
	timelineCache.set(key, value);
}

export async function collectActionTimeline(
	ctx: ExtensionContext,
	def: CapabilityDef,
	task: string,
	conversation: string,
	signal?: AbortSignal,
): Promise<string> {
	if (!conversation) return "";

	const cacheKey = [
		def.timelineModel,
		def.maxTimelineChars,
		hashText(task.trim()),
		hashText(conversation),
	].join(":");
	const cached = timelineCache.get(cacheKey);
	if (cached !== undefined) return cached;

	const modelRef = splitModelRef(def.timelineModel);
	if (!modelRef) return "";

	const model = ctx.modelRegistry.find(modelRef.provider, modelRef.modelId);
	if (!model) return "";

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok || !auth.apiKey) return "";

	try {
		const response = await complete(
			model,
			{
				systemPrompt: TIMELINE_SYSTEM_PROMPT,
				messages: [
					{
						role: "user",
						content: [{
							type: "text",
							text: [
								"## Current Helper Task",
								task.trim(),
								"",
								"## Conversation",
								conversation,
							].join("\n"),
						}],
						timestamp: Date.now(),
					},
				],
			},
			{
				apiKey: auth.apiKey,
				headers: auth.headers,
				signal,
				reasoningEffort: model.reasoning ? "medium" : undefined,
			},
		);

		const timeline = truncateHead(extractText(response), def.maxTimelineChars);
		if (timeline) setTimelineCache(cacheKey, timeline);
		return timeline;
	} catch {
		return "";
	}
}
