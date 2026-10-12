/**
 * Pi streamSimple via @anthropic-ai/claude-agent-sdk query().
 * Live thinking/text from includePartialMessages stream_event.
 * XML tool bridge + session mirror (Pi executes tools; Claude tools stay off).
 */
import { query, type Options as SdkOptions, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
	calculateCost,
	createAssistantMessageEventStream,
	type Api,
	type AssistantMessage,
	type AssistantMessageEventStream,
	type Message,
	type Model,
	type SimpleStreamOptions,
	type ToolCall,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import { describeStreamError } from "./cli.ts";
import { parseToolCallsWithMorphRepair } from "./morphRepair.ts";
import {
	bridgeConfigHashMaterial,
	bridgeContext,
	bridgeSystemPrompt,
	buildDeltaPrompt,
	buildPrompt,
	safeJson,
	selectSentMessages,
	type BridgeContext,
} from "./prompt.ts";
import { buildQueryOptions, type SessionMode } from "./queryOptions.ts";
import {
	canResume,
	ensureRecord,
	getActivePiSessionId,
	hashSystemPrompt,
	markSeeded,
	noteMode,
	reseedRecord,
	type SessionRecord,
} from "./sessions.ts";

const RESEED_SIGNATURES = ["already in use", "No conversation found"];

function isSessionLoss(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return RESEED_SIGNATURES.some((sig) => message.includes(sig));
}

function isCapabilityCall(options?: SimpleStreamOptions): boolean {
	return typeof options?.metadata?.capability === "string";
}

function isMainSessionTurn(bridge: BridgeContext, options?: SimpleStreamOptions): boolean {
	return !isCapabilityCall(options) && bridge.tools.length > 0;
}

function emptyUsage(): AssistantMessage["usage"] {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function idleMs(): number {
	const configured = Number(process.env.CLAUDE_CODE_SDK_IDLE_MS);
	if (Number.isFinite(configured) && configured > 0) return configured;
	return 5 * 60_000;
}

type Mirror = {
	mode: SessionMode;
	record?: SessionRecord;
	bridge: BridgeContext;
	prompt: string;
	sentMessages: Message[];
};

async function resolveMirror(context: TranscriptContext, options?: SimpleStreamOptions): Promise<Mirror> {
	const bridge = bridgeContext(context);
	const piSessionId = getActivePiSessionId();
	if (!piSessionId || !isMainSessionTurn(bridge, options)) {
		return { mode: "none", bridge, prompt: buildPrompt(bridge), sentMessages: bridge.messages };
	}

	const record = await ensureRecord(piSessionId, process.cwd());
	const systemHash = hashSystemPrompt(bridgeConfigHashMaterial(bridge.systemPrompt, bridge.tools));
	if (record.initialized && record.systemHash === systemHash && canResume(record, bridge.messages)) {
		return {
			mode: "resume",
			record,
			bridge,
			prompt: buildDeltaPrompt(bridge, record.syncedCount, record.lastReplyHash),
			sentMessages: selectSentMessages(bridge, record.syncedCount, record.lastReplyHash),
		};
	}
	if (!record.initialized) {
		return { mode: "seed", record, bridge, prompt: buildPrompt(bridge), sentMessages: bridge.messages };
	}
	if (record.systemHash === systemHash) {
		const next = await reseedRecord(piSessionId, process.cwd());
		return { mode: "seed", record: next, bridge, prompt: buildPrompt(bridge), sentMessages: bridge.messages };
	}
	return { mode: "none", bridge, prompt: buildPrompt(bridge), sentMessages: bridge.messages };
}

type TurnAccum = {
	text: string;
	thinking: string;
	sessionId?: string;
	isError: boolean;
	usage?: { input: number; output: number; cacheRead: number; cacheWrite: number };
};

function applyUsage(model: Model<Api>, output: AssistantMessage, accum: TurnAccum, prompt: string) {
	if (accum.usage) {
		output.usage.input = accum.usage.input;
		output.usage.output = accum.usage.output;
		output.usage.cacheRead = accum.usage.cacheRead;
		output.usage.cacheWrite = accum.usage.cacheWrite;
		output.usage.totalTokens =
			accum.usage.input + accum.usage.output + accum.usage.cacheRead + accum.usage.cacheWrite;
		calculateCost(model, output.usage);
		return;
	}
	const estimate = Math.max(1, Math.ceil(prompt.length / 4));
	output.usage.input = estimate;
	output.usage.output = Math.max(1, Math.ceil((accum.text || "").length / 4));
	output.usage.totalTokens = output.usage.input + output.usage.output;
	calculateCost(model, output.usage);
}

export function streamClaudeSdk(
	model: Model<Api>,
	context: TranscriptContext,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();

	(async () => {
		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: emptyUsage(),
			stopReason: "stop",
			timestamp: Date.now(),
		};

		let mirror: Mirror | undefined;
		const abortController = new AbortController();
		const onAbort = () => abortController.abort();
		options?.signal?.addEventListener("abort", onAbort, { once: true });

		let idleTimer: ReturnType<typeof setTimeout> | undefined;
		const bumpIdle = () => {
			if (idleTimer) clearTimeout(idleTimer);
			idleTimer = setTimeout(() => abortController.abort(), idleMs());
		};

		try {
			mirror = await resolveMirror(context, options);
			stream.push({ type: "start", partial: output });

			const runOnce = async (): Promise<TurnAccum> => {
				const sdkSystemPrompt = bridgeSystemPrompt(mirror!.bridge.tools, mirror!.bridge.systemPrompt);
				const sdkOptions: SdkOptions = buildQueryOptions({
					modelId: model.id,
					reasoning: options?.reasoning,
					thinkingLevelMap: model.thinkingLevelMap,
					systemPrompt: sdkSystemPrompt,
					mode: mirror!.mode,
					claudeSessionId: mirror!.record?.claudeSessionId,
					cwd: mirror!.record?.cwd || process.cwd(),
					abortController,
				});

				const q = query({ prompt: mirror!.prompt, options: sdkOptions });
				const accum: TurnAccum = { text: "", thinking: "", isError: false };
				let thinkingIndex: number | undefined;
				let textIndex: number | undefined;
				const openThinking = new Map<number, number>();

				bumpIdle();
				const onIdleOrAbort = () => {
					void q.interrupt().catch(() => undefined);
				};
				abortController.signal.addEventListener("abort", onIdleOrAbort, { once: true });
				try {
					for await (const message of q) {
						bumpIdle();
						handleSdkMessage(message, {
							accum,
							output,
							stream,
							openThinking,
							getThinkingIndex: () => thinkingIndex,
							setThinkingIndex: (i) => {
								thinkingIndex = i;
							},
							getTextIndex: () => textIndex,
							setTextIndex: (i) => {
								textIndex = i;
							},
							expectedSessionId: mirror!.record?.claudeSessionId,
						});
					}
				} finally {
					abortController.signal.removeEventListener("abort", onIdleOrAbort);
				}

				if (thinkingIndex !== undefined) {
					const part = output.content[thinkingIndex];
					if (part && part.type === "thinking") {
						stream.push({
							type: "thinking_end",
							contentIndex: thinkingIndex,
							content: part.thinking,
							partial: output,
						});
					}
				}
				if (textIndex !== undefined) {
					const part = output.content[textIndex];
					if (part && part.type === "text") {
						stream.push({
							type: "text_end",
							contentIndex: textIndex,
							content: part.text,
							partial: output,
						});
					}
				}

				return accum;
			};

			let accum: TurnAccum;
			try {
				accum = await runOnce();
			} catch (error) {
				if (options?.signal?.aborted || abortController.signal.aborted) throw error;
				if (mirror.record && (mirror.mode === "seed" || mirror.mode === "resume") && isSessionLoss(error)) {
					const record = await reseedRecord(mirror.record.piSessionId, process.cwd());
					mirror = {
						mode: "seed",
						record,
						bridge: mirror.bridge,
						prompt: buildPrompt(mirror.bridge),
						sentMessages: mirror.bridge.messages,
					};
					accum = await runOnce();
				} else {
					throw error;
				}
			}

			if (accum.sessionId && mirror.record && accum.sessionId !== mirror.record.claudeSessionId) {
				throw new Error(
					`Claude Code used session ${accum.sessionId}, expected ${mirror.record.claudeSessionId}; mirror state unknown.`,
				);
			}
			if (accum.isError) throw new Error(accum.text || "claude-agent-sdk returned an error result");

			if (mirror.record) {
				await markSeeded(
					mirror.record,
					mirror.bridge.messages,
					bridgeConfigHashMaterial(mirror.bridge.systemPrompt, mirror.bridge.tools),
					mirror.mode,
					[accum.thinking, accum.text].filter(Boolean).join("\n") || undefined,
				);
			} else if (mirror.mode === "none") {
				const piSessionId = getActivePiSessionId();
				if (piSessionId) await noteMode(piSessionId, "none");
			}

			applyUsage(model, output, accum, mirror.prompt);

			const allowTools =
				mirror.bridge.tools.length > 0 &&
				(!isCapabilityCall(options) || options?.metadata?.capabilityTools === true);
			const responseText = accum.text;
			const toolCalls = allowTools
				? await parseToolCallsWithMorphRepair(responseText, options?.signal)
				: [];

			if (toolCalls.length > 0) {
				// Drop streamed text that was only the tool XML carrier.
				output.content = output.content.filter((part) => part.type !== "text");
				output.stopReason = "toolUse";
				for (const call of toolCalls) {
					const toolCall: ToolCall = {
						type: "toolCall",
						id: `claude_code_sdk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
						name: call.name,
						arguments: call.arguments,
					};
					const toolIndex = output.content.length;
					output.content.push(toolCall);
					stream.push({ type: "toolcall_start", contentIndex: toolIndex, partial: output });
					stream.push({
						type: "toolcall_delta",
						contentIndex: toolIndex,
						delta: safeJson(toolCall.arguments),
						partial: output,
					});
					stream.push({ type: "toolcall_end", contentIndex: toolIndex, toolCall, partial: output });
				}
				stream.push({ type: "done", reason: "toolUse", message: output });
				stream.end();
				return;
			}

			// Text already streamed via deltas; if none opened, emit once.
			if (!output.content.some((part) => part.type === "text")) {
				const contentIndex = output.content.length;
				output.content.push({ type: "text", text: responseText });
				stream.push({ type: "text_start", contentIndex, partial: output });
				if (responseText) {
					stream.push({ type: "text_delta", contentIndex, delta: responseText, partial: output });
				}
				stream.push({ type: "text_end", contentIndex, content: responseText, partial: output });
			}

			stream.push({ type: "done", reason: "stop", message: output });
			stream.end();
		} catch (error) {
			if (mirror?.record && mirror.mode !== "none" && getActivePiSessionId()) {
				await reseedRecord(mirror.record.piSessionId, process.cwd()).catch(() => undefined);
			}
			output.stopReason =
				options?.signal?.aborted || abortController.signal.aborted ? "aborted" : "error";
			output.errorMessage = await describeStreamError(error);
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		} finally {
			if (idleTimer) clearTimeout(idleTimer);
			options?.signal?.removeEventListener("abort", onAbort);
		}
	})();

	return stream;
}

type HandlerState = {
	accum: TurnAccum;
	output: AssistantMessage;
	stream: AssistantMessageEventStream;
	openThinking: Map<number, number>;
	getThinkingIndex: () => number | undefined;
	setThinkingIndex: (i: number) => void;
	getTextIndex: () => number | undefined;
	setTextIndex: (i: number) => void;
	expectedSessionId?: string;
};

function handleSdkMessage(message: SDKMessage, state: HandlerState): void {
	if (message.type === "system" && (message as { subtype?: string }).subtype === "init") {
		const sessionId = (message as { session_id?: string }).session_id;
		if (sessionId) state.accum.sessionId = sessionId;
		return;
	}

	if (message.type === "stream_event") {
		const event = (message as { event: Record<string, unknown> }).event;
		if (!event || typeof event !== "object") return;
		const eventType = event.type as string;

		if (eventType === "content_block_start") {
			const block = event.content_block as { type?: string; thinking?: string; text?: string } | undefined;
			const index = event.index as number;
			if (block?.type === "thinking") {
				let thinkingIndex = state.getThinkingIndex();
				if (thinkingIndex === undefined) {
					thinkingIndex = state.output.content.length;
					state.output.content.push({ type: "thinking", thinking: block.thinking ?? "" });
					state.setThinkingIndex(thinkingIndex);
					state.stream.push({ type: "thinking_start", contentIndex: thinkingIndex, partial: state.output });
				}
				state.openThinking.set(index, thinkingIndex);
				if (block.thinking) {
					appendThinking(state, thinkingIndex, block.thinking);
				}
			} else if (block?.type === "text") {
				let textIndex = state.getTextIndex();
				if (textIndex === undefined) {
					textIndex = state.output.content.length;
					state.output.content.push({ type: "text", text: block.text ?? "" });
					state.setTextIndex(textIndex);
					state.stream.push({ type: "text_start", contentIndex: textIndex, partial: state.output });
				}
				if (block.text) appendText(state, textIndex, block.text);
			}
			return;
		}

		if (eventType === "content_block_delta") {
			const delta = event.delta as { type?: string; thinking?: string; text?: string } | undefined;
			const index = event.index as number;
			if (delta?.type === "thinking_delta" && delta.thinking) {
				const thinkingIndex = state.openThinking.get(index) ?? state.getThinkingIndex();
				if (thinkingIndex !== undefined) appendThinking(state, thinkingIndex, delta.thinking);
			} else if (delta?.type === "text_delta" && delta.text) {
				let textIndex = state.getTextIndex();
				if (textIndex === undefined) {
					textIndex = state.output.content.length;
					state.output.content.push({ type: "text", text: "" });
					state.setTextIndex(textIndex);
					state.stream.push({ type: "text_start", contentIndex: textIndex, partial: state.output });
				}
				appendText(state, textIndex, delta.text);
			}
			return;
		}

		if (eventType === "content_block_stop") {
			state.openThinking.delete(event.index as number);
			return;
		}
		return;
	}

	if (message.type === "assistant") {
		const content = (message as { message?: { content?: Array<{ type: string; thinking?: string; text?: string }> } })
			.message?.content;
		if (!Array.isArray(content)) return;
		for (const block of content) {
			if (block.type === "thinking" && block.thinking && !state.accum.thinking.includes(block.thinking)) {
				// Snapshot fill if stream missed it.
				if (state.getThinkingIndex() === undefined) {
					const thinkingIndex = state.output.content.length;
					state.output.content.push({ type: "thinking", thinking: block.thinking });
					state.setThinkingIndex(thinkingIndex);
					state.stream.push({ type: "thinking_start", contentIndex: thinkingIndex, partial: state.output });
					appendThinking(state, thinkingIndex, block.thinking);
				}
			}
			if (block.type === "text" && block.text && !state.accum.text.includes(block.text)) {
				if (state.getTextIndex() === undefined) {
					const textIndex = state.output.content.length;
					state.output.content.push({ type: "text", text: block.text });
					state.setTextIndex(textIndex);
					state.stream.push({ type: "text_start", contentIndex: textIndex, partial: state.output });
					appendText(state, textIndex, block.text);
				}
			}
		}
		return;
	}

	if (message.type === "result") {
		const result = message as {
			subtype?: string;
			is_error?: boolean;
			result?: string;
			session_id?: string;
			usage?: {
				input_tokens?: number;
				output_tokens?: number;
				cache_read_input_tokens?: number;
				cache_creation_input_tokens?: number;
			};
		};
		if (result.session_id) state.accum.sessionId = result.session_id;
		state.accum.isError = Boolean(result.is_error || result.subtype === "error");
		if (typeof result.result === "string" && result.result && !state.accum.text) {
			state.accum.text = result.result;
		}
		if (result.usage) {
			state.accum.usage = {
				input: result.usage.input_tokens ?? 0,
				output: result.usage.output_tokens ?? 0,
				cacheRead: result.usage.cache_read_input_tokens ?? 0,
				cacheWrite: result.usage.cache_creation_input_tokens ?? 0,
			};
		}
	}
}

function appendThinking(state: HandlerState, thinkingIndex: number, delta: string): void {
	const part = state.output.content[thinkingIndex];
	if (!part || part.type !== "thinking") return;
	part.thinking += delta;
	state.accum.thinking += delta;
	state.stream.push({
		type: "thinking_delta",
		contentIndex: thinkingIndex,
		delta,
		partial: state.output,
	});
}

function appendText(state: HandlerState, textIndex: number, delta: string): void {
	const part = state.output.content[textIndex];
	if (!part || part.type !== "text") return;
	part.text += delta;
	state.accum.text += delta;
	state.stream.push({
		type: "text_delta",
		contentIndex: textIndex,
		delta,
		partial: state.output,
	});
}
