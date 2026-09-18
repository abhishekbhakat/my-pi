/**
 * Vendored from pi-coding-agent dist/core/compaction/compaction.js
 * (summarize + compact only. Cut point still runs in core before the hook.)
 */
import type { AgentMessage, StreamFn, ThinkingLevel } from "@earendil-works/pi-agent-core";
import { contentText, retryAssistantCall, uuidv7 } from "@earendil-works/pi-ai";
import type { RetryCallbacks, RetryPolicy } from "@earendil-works/pi-ai";
import { completeSimple } from "@earendil-works/pi-ai/compat";
import type { AssistantMessage, Context, Model, SimpleStreamOptions, Usage } from "@earendil-works/pi-ai/compat";
import type { CompactionPreparation, CompactionResult } from "@earendil-works/pi-coding-agent";
import { convertToLlm } from "@earendil-works/pi-coding-agent";
import { pruneToolPairs, type JevCallBudget } from "./prune.ts";
import { SUMMARIZATION_PROMPT, TURN_PREFIX_SUMMARIZATION_PROMPT, UPDATE_SUMMARIZATION_PROMPT } from "./prompts.ts";
import {
	computeFileLists,
	formatFileOperations,
	serializeConversation,
	SUMMARIZATION_SYSTEM_PROMPT,
} from "./utils.ts";

// Shared budget: 2 Jev calls per compact, both history and turn-prefix draw from it.
const jevBudget: JevCallBudget = { remaining: 2 };

function combineUsage(first: Usage, second: Usage): Usage {
	return {
		input: first.input + second.input,
		output: first.output + second.output,
		cacheRead: first.cacheRead + second.cacheRead,
		cacheWrite: first.cacheWrite + second.cacheWrite,
		...(first.cacheWrite1h !== undefined || second.cacheWrite1h !== undefined
			? { cacheWrite1h: (first.cacheWrite1h ?? 0) + (second.cacheWrite1h ?? 0) }
			: {}),
		...(first.reasoning !== undefined || second.reasoning !== undefined
			? { reasoning: (first.reasoning ?? 0) + (second.reasoning ?? 0) }
			: {}),
		totalTokens: first.totalTokens + second.totalTokens,
		cost: {
			input: first.cost.input + second.cost.input,
			output: first.cost.output + second.cost.output,
			cacheRead: first.cost.cacheRead + second.cost.cacheRead,
			cacheWrite: first.cost.cacheWrite + second.cost.cacheWrite,
			total: first.cost.total + second.cost.total,
		},
	};
}

export function getSummarizationFailure(response: AssistantMessage, label: string): string | undefined {
	if (response.stopReason === "error") {
		return `${label} failed: ${response.errorMessage || "Unknown error"}`;
	}
	if (response.stopReason === "length") {
		return `${label} failed: generation hit the token cap and the summary is incomplete`;
	}
	return undefined;
}

function createSummarizationOptions(
	model: Model<any>,
	maxTokens: number,
	apiKey: string | undefined,
	headers: Record<string, string> | undefined,
	env: Record<string, string> | undefined,
	signal: AbortSignal | undefined,
	thinkingLevel: ThinkingLevel | undefined,
	sessionId: string | undefined,
): SimpleStreamOptions {
	const options: SimpleStreamOptions = { maxTokens, signal, apiKey, headers, env, sessionId };
	if (model.reasoning && thinkingLevel && thinkingLevel !== "off") {
		(options as SimpleStreamOptions & { reasoning?: ThinkingLevel }).reasoning = thinkingLevel;
	}
	return options;
}

export async function completeSummarization(
	model: Model<any>,
	context: Context,
	options: SimpleStreamOptions,
	streamFn?: StreamFn,
	retry?: RetryPolicy,
	callbacks?: RetryCallbacks,
): Promise<AssistantMessage> {
	const requestOptions = {
		...options,
		cacheRetention: "none" as const,
		sessionId: options.sessionId ?? uuidv7(),
	};
	const produce = async () =>
		streamFn
			? (await streamFn(model, context, requestOptions)).result()
			: completeSimple(model, context, requestOptions);
	return retryAssistantCall(produce, retry, requestOptions.signal, callbacks);
}

function buildSummarizationContext(promptText: string): Context {
	return {
		systemPrompt: SUMMARIZATION_SYSTEM_PROMPT,
		messages: [
			{
				role: "user",
				content: [{ type: "text", text: promptText }],
				timestamp: Date.now(),
			},
		],
	};
}

export async function generateSummaryWithUsage(
	currentMessages: AgentMessage[],
	model: Model<any>,
	reserveTokens: number,
	apiKey: string | undefined,
	headers: Record<string, string> | undefined,
	signal: AbortSignal | undefined,
	customInstructions: string | undefined,
	previousSummary: string | undefined,
	thinkingLevel: ThinkingLevel | undefined,
	streamFn: StreamFn | undefined,
	env: Record<string, string> | undefined,
	retry: RetryPolicy | undefined,
	callbacks: RetryCallbacks | undefined,
	sessionId: string | undefined,
	onStatus?: (message: string | undefined) => void,
): Promise<{ text: string; usage: Usage }> {
	const maxTokens = Math.min(
		Math.floor(0.8 * reserveTokens),
		model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY,
	);
	let basePrompt = previousSummary ? UPDATE_SUMMARIZATION_PROMPT : SUMMARIZATION_PROMPT;
	if (customInstructions) {
		basePrompt = `${basePrompt}\n\nAdditional focus: ${customInstructions}`;
	}
	// Prune first; fail-open: no key or error returns empty drop set,
	// so serialize is unchanged.
	const llmMessages = convertToLlm(currentMessages);
	const historyDrop = await pruneToolPairs(llmMessages, previousSummary, signal, jevBudget);
	onStatus?.("compaction: summarizing…");
	const conversationText = serializeConversation(llmMessages, historyDrop);
	let promptText = `<conversation>\n${conversationText}\n</conversation>\n\n`;
	if (previousSummary) {
		promptText += `<previous-summary>\n${previousSummary}\n</previous-summary>\n\n`;
	}
	promptText += basePrompt;
	const completionOptions = createSummarizationOptions(
		model,
		maxTokens,
		apiKey,
		headers,
		env,
		signal,
		thinkingLevel,
		sessionId,
	);
	const response = await completeSummarization(
		model,
		buildSummarizationContext(promptText),
		completionOptions,
		streamFn,
		retry,
		callbacks,
	);
	const failure = getSummarizationFailure(response, "Summarization");
	if (failure) throw new Error(failure);
	if (response.content.some((block) => block.type === "toolCall")) {
		throw new Error("Summarization attempted to call a tool");
	}
	return { text: contentText(response.content), usage: response.usage };
}

async function generateTurnPrefixSummary(
	messages: AgentMessage[],
	model: Model<any>,
	reserveTokens: number,
	apiKey: string | undefined,
	headers: Record<string, string> | undefined,
	env: Record<string, string> | undefined,
	signal: AbortSignal | undefined,
	thinkingLevel: ThinkingLevel | undefined,
	streamFn: StreamFn | undefined,
	retry: RetryPolicy | undefined,
	callbacks: RetryCallbacks | undefined,
	sessionId: string | undefined,
	onStatus?: (message: string | undefined) => void,
): Promise<{ text: string; usage: Usage }> {
	const maxTokens = Math.min(
		Math.floor(0.5 * reserveTokens),
		model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY,
	);
	const llmMessages = convertToLlm(messages);
	const prefixDrop = await pruneToolPairs(llmMessages, undefined, signal, jevBudget);
	onStatus?.("compaction: summarizing…");
	const conversationText = serializeConversation(llmMessages, prefixDrop);
	const promptText = `<conversation>\n${conversationText}\n</conversation>\n\n${TURN_PREFIX_SUMMARIZATION_PROMPT}`;
	const response = await completeSummarization(
		model,
		buildSummarizationContext(promptText),
		createSummarizationOptions(model, maxTokens, apiKey, headers, env, signal, thinkingLevel, sessionId),
		streamFn,
		retry,
		callbacks,
	);
	const failure = getSummarizationFailure(response, "Turn prefix summarization");
	if (failure) throw new Error(failure);
	if (response.content.some((block) => block.type === "toolCall")) {
		throw new Error("Turn prefix summarization attempted to call a tool");
	}
	return { text: contentText(response.content), usage: response.usage };
}

export async function compactLocal(
	preparation: CompactionPreparation,
	model: Model<any>,
	apiKey: string | undefined,
	headers: Record<string, string> | undefined,
	customInstructions: string | undefined,
	signal: AbortSignal | undefined,
	thinkingLevel: ThinkingLevel | undefined,
	streamFn: StreamFn | undefined,
	env: Record<string, string> | undefined,
	retry: RetryPolicy | undefined,
	callbacks: RetryCallbacks | undefined,
	sessionId: string | undefined,
	onStatus?: (message: string | undefined) => void,
): Promise<CompactionResult> {
	// Prune budget resets per compact.
	jevBudget.remaining = 2;
	onStatus?.("compaction: pruning tool pairs (Jev)…");
	const {
		firstKeptEntryId,
		messagesToSummarize,
		turnPrefixMessages,
		isSplitTurn,
		tokensBefore,
		previousSummary,
		fileOps,
		settings,
	} = preparation;

	let summary: string;
	let summaryUsage: Usage | undefined;

	if (isSplitTurn && turnPrefixMessages.length > 0) {
		let historyText = "No prior history.";
		let historyUsage: Usage | undefined;
		if (messagesToSummarize.length > 0) {
			const historyResult = await generateSummaryWithUsage(
				messagesToSummarize,
				model,
				settings.reserveTokens,
				apiKey,
				headers,
				signal,
				customInstructions,
				previousSummary,
				thinkingLevel,
				streamFn,
				env,
				retry,
				callbacks,
				sessionId,
				onStatus,
			);
			historyText = historyResult.text;
			historyUsage = historyResult.usage;
		}
		const turnPrefixResult = await generateTurnPrefixSummary(
			turnPrefixMessages,
			model,
			settings.reserveTokens,
			apiKey,
			headers,
			env,
			signal,
			thinkingLevel,
			streamFn,
			retry,
			callbacks,
			sessionId,
			onStatus,
		);
		summary = `${historyText}\n\n---\n\n**Turn Context (split turn):**\n\n${turnPrefixResult.text}`;
		summaryUsage = historyUsage ? combineUsage(historyUsage, turnPrefixResult.usage) : turnPrefixResult.usage;
	} else {
		const result = await generateSummaryWithUsage(
			messagesToSummarize,
			model,
			settings.reserveTokens,
			apiKey,
			headers,
			signal,
			customInstructions,
			previousSummary,
			thinkingLevel,
			streamFn,
			env,
			retry,
			callbacks,
			sessionId,
			onStatus,
		);
		summary = result.text;
		summaryUsage = result.usage;
	}

	const { readFiles, modifiedFiles } = computeFileLists(fileOps);
	summary += formatFileOperations(readFiles, modifiedFiles);
	onStatus?.(undefined);
	if (!firstKeptEntryId) {
		throw new Error("First kept entry has no UUID - session may need migration");
	}
	return {
		summary,
		firstKeptEntryId,
		tokensBefore,
		usage: summaryUsage,
		details: { readFiles, modifiedFiles },
	};
}
