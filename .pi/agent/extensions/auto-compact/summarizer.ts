/**
 * Fixed-model compaction summarizer for the auto-compact extension.
 *
 * Intercepts session_before_compact and generates the summary with a
 * configured model instead of the session model. Applied to manual and
 * threshold compactions only; overflow recovery always uses stock.
 * Any failure (missing model, empty/truncated output, error, abort)
 * returns undefined so the stock compaction path runs as fallback.
 */

import { uuidv7 } from "@earendil-works/pi-ai";
import {
	convertToLlm,
	serializeConversation,
	type CompactionResult,
	type ExtensionContext,
	type SessionBeforeCompactEvent,
} from "@earendil-works/pi-coding-agent";
import { parseModelRef, type AutoCompactConfig, type ThinkingLevelName } from "./config";

/** Output budget for the summary call. Thinking tokens come out of this. */
export const MAX_SUMMARY_TOKENS = 32_768;

type AnyModel = NonNullable<ReturnType<ExtensionContext["modelRegistry"]["find"]>>;

/** openai-codex-responses reasoning effort values. */
const CODEX_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

type CodxEffort = (typeof CODEX_EFFORTS)[number];

function toCodxEffort(level: ThinkingLevelName): CodxEffort {
	return level === "off" ? "none" : (level as CodxEffort);
}

const SUMMARY_PROMPT = `You are a conversation summarizer for a coding agent session. The summary below will replace the summarized history as the agent's memory of this conversation.

Create a structured markdown summary that captures:

1. Goals and objectives, including any constraints the user stated
2. Key decisions made and their rationale
3. File changes: which files were read, created, or modified, and current state of in-flight edits
4. Errors encountered and how they were resolved (or not)
5. Current state of ongoing work: what is done, what is in progress
6. Blockers, open questions, and planned next steps

Preserve exact file paths, commands, error messages, and identifiers. Keep enough detail to continue the work without re-discovering anything. Be thorough but concise.`;

function buildPrompt(
	conversationText: string,
	previousSummary: string | undefined,
	customInstructions: string | undefined,
): string {
	const previous = previousSummary
		? `\n\nEarlier context was already summarized. Incorporate it without losing facts:\n${previousSummary}\n`
		: "";
	const extra = customInstructions ? `\n\nAdditional focus requested by the caller:\n${customInstructions}\n` : "";
	return `${SUMMARY_PROMPT}${previous}${extra}

<conversation>
${conversationText}
</conversation>`;
}

function extractText(response: { content: readonly unknown[] }): string {
	return response.content
		.filter((block): block is { type: string; text: string } => {
			if (!block || typeof block !== "object") return false;
			const b = block as { type?: unknown; text?: unknown };
			return b.type === "text" && typeof b.text === "string";
		})
		.map((block) => block.text)
		.join("\n");
}

export type SummarizeOutcome =
	| { kind: "ok"; result: CompactionResult }
	| { kind: "skip" } // compactModel not set; stock path
	| { kind: "model-missing" }
	| { kind: "fallback"; message: string }
	| { kind: "aborted" };

/**
 * Run the fixed-model summarization for a compaction event.
 * Returns undefined-compatible outcome; caller returns `result` only for "ok".
 */
export async function summarizeWithFixedModel(
	event: SessionBeforeCompactEvent,
	ctx: ExtensionContext,
	config: AutoCompactConfig,
): Promise<SummarizeOutcome> {
	// Overflow recovery is the one path we never intercept: a slow or failed
	// fixed-model call here would stall or kill the retry. Stock handles it.
	if (event.reason === "overflow") return { kind: "skip" };

	const ref = parseModelRef(config.compactModel);
	if (!ref) return { kind: "skip" };

	const model: AnyModel | undefined = ctx.modelRegistry.find(ref.provider, ref.modelId);
	if (!model) return { kind: "model-missing" };

	const { preparation, signal, customInstructions } = event;
	const allMessages = [...preparation.messagesToSummarize, ...preparation.turnPrefixMessages];
	if (allMessages.length === 0) return { kind: "skip" };

	const conversationText = serializeConversation(convertToLlm(allMessages));
	const prompt = buildPrompt(conversationText, preparation.previousSummary, customInstructions);

	if (config.notify && ctx.hasUI) {
		ctx.ui.notify(
			`Compacting with ${model.provider}/${model.id} (thinking: ${config.compactThinking})…`,
			"info",
		);
	}

	const baseOptions = {
		maxTokens: MAX_SUMMARY_TOKENS,
		signal,
		cacheRetention: "none" as const,
		sessionId: uuidv7(),
	};
	const context = {
		messages: [{ role: "user" as const, content: [{ type: "text" as const, text: prompt }], timestamp: Date.now() }],
	};

	try {
		// Thinking is wired per-API. openai-codex-responses uses reasoningEffort;
		// other APIs run without an explicit thinking budget.
		const response =
			model.api === "openai-codex-responses"
				? await ctx.modelRegistry.complete(
						model,
						context,
						{ ...baseOptions, reasoningEffort: toCodxEffort(config.compactThinking) },
					)
				: await ctx.modelRegistry.complete(model, context, baseOptions);

		if (signal.aborted) return { kind: "aborted" };

		// Only a clean finish is acceptable. length/error/aborted/toolUse/deferred
		// all mean the summary is incomplete or bogus; fall back to stock.
		if (response.stopReason !== "stop") {
			return {
				kind: "fallback",
				message: `fixed-model compaction ended with stopReason "${response.stopReason}"`,
			};
		}

		const summary = extractText(response).trim();
		if (!summary) {
			return { kind: "fallback", message: "fixed-model summary was empty" };
		}

		return {
			kind: "ok",
			result: {
				summary,
				firstKeptEntryId: preparation.firstKeptEntryId,
				tokensBefore: preparation.tokensBefore,
				usage: response.usage,
			},
		};
	} catch (error) {
		if (signal.aborted) return { kind: "aborted" };
		const message = error instanceof Error ? error.message : String(error);
		return { kind: "fallback", message };
	}
}
