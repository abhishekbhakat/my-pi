/**
 * Build Claude Agent SDK query() options.
 * Pattern copied from t3code ClaudeAdapterV2 buildQueryOptions:
 * pathToClaudeCodeExecutable, includePartialMessages, thinking adaptive+summarized,
 * effort, tools [], dontAsk, persistSession / sessionId / resume.
 */
import type { EffortLevel, Options as SdkOptions, ThinkingConfig } from "@anthropic-ai/claude-agent-sdk";
import type { ModelThinkingLevel, ThinkingLevelMap } from "@earendil-works/pi-ai";
import { claudeBin, claudeEnv } from "./cli.ts";

export type SessionMode = "seed" | "resume" | "none";

export function mapEffort(
	level: ModelThinkingLevel | undefined,
	map?: ThinkingLevelMap,
): EffortLevel | undefined {
	if (!level || level === "off") return undefined;
	const effort = map?.[level];
	if (!effort || typeof effort !== "string") return undefined;
	return effort as EffortLevel;
}

export function buildThinkingConfig(level: ModelThinkingLevel | undefined): ThinkingConfig | undefined {
	if (!level || level === "off") return { type: "disabled" };
	return { type: "adaptive", display: "summarized" };
}

export function buildQueryOptions(input: {
	modelId: string;
	reasoning?: ModelThinkingLevel;
	thinkingLevelMap?: ThinkingLevelMap;
	systemPrompt: string;
	mode: SessionMode;
	claudeSessionId?: string;
	cwd: string;
	abortController: AbortController;
}): SdkOptions {
	const effort = mapEffort(input.reasoning, input.thinkingLevelMap);
	const thinking = buildThinkingConfig(input.reasoning);
	const requestThinkingSummaries = Boolean(thinking && thinking.type !== "disabled");

	const identity: Pick<SdkOptions, "sessionId" | "resume" | "persistSession"> =
		input.mode === "none" || !input.claudeSessionId
			? { persistSession: false }
			: input.mode === "resume"
				? { resume: input.claudeSessionId }
				: { sessionId: input.claudeSessionId };

	return {
		model: input.modelId,
		systemPrompt: input.systemPrompt,
		tools: [],
		permissionMode: "dontAsk",
		includePartialMessages: true,
		cwd: input.cwd,
		pathToClaudeCodeExecutable: claudeBin(),
		env: claudeEnv(),
		abortController: input.abortController,
		...(effort ? { effort } : {}),
		...(thinking ? { thinking } : {}),
		...(requestThinkingSummaries
			? {
					extraArgs: { "thinking-display": "summarized" },
					settings: { showThinkingSummaries: true },
				}
			: {}),
		...identity,
	};
}
