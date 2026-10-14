/**
 * Pi streamSimple via @anthropic-ai/claude-agent-sdk query(), native tool loop.
 *
 * One SDK drain per user message (an ActiveBridgeTurn). Provider cycles
 * attach to it: each cycle streams thinking/text deltas live, emits the
 * model's tool_use blocks as real Pi toolCall parts (stopReason toolUse, so
 * Pi executes them model-issued through its own full pipeline: validation,
 * hooks, damage control, permission checks), and ends. The next cycle
 * pre-work feeds Pi's toolResult messages back to the pending MCP handlers,
 * which lets the CLI continue the SDK turn natively (tool_use → tool_result,
 * ids bound). The SDK result ends the last cycle with the final reply.
 *
 * Capability turns (no tools) and no-tools main turns stay one-shot.
 */
import { query, type SDKMessage, type Options as SdkOptions } from "@anthropic-ai/claude-agent-sdk";
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
import { buildPiMcpServer } from "./mcpBridge.ts";
import {
	ActiveBridgeTurn,
	clearActiveTurn,
	getActiveTurn,
	getSessionEpoch,
	logBridge,
	piToolName,
	registryKey,
	setActiveTurn,
} from "./rendezvous.ts";
import {
	bridgeConfigHashMaterial,
	bridgeContext,
	bridgeSystemPrompt,
	buildDeltaPrompt,
	buildPrompt,
	selectSentMessages,
	type BridgeContext,
} from "./prompt.ts";
import { buildQueryOptions, type SessionMode } from "./queryOptions.ts";
import {
	canResume,
	readClaudeOutputTokens,
	deleteClaudeSessionFile,
	ensureRecord,
	getActivePiSessionId,
	hashSystemPrompt,
	markSeeded,
	noteMode,
	reseedRecord,
	saveRecord,
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
	if (!piSessionId || isCapabilityCall(options) || bridge.tools.length === 0) {
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
		// A prior seed may have written the Claude jsonl without marking the
		// mirror (crash / race). Reusing that UUID yields "already in use".
		const existing = await deleteClaudeSessionFile(record.claudeSessionId, record.cwd);
		if (existing) {
			const next = await reseedRecord(piSessionId, process.cwd());
			logBridge("seed_uuid_collision", `${piSessionId} dropped ${record.claudeSessionId} -> ${next.claudeSessionId}`);
			return { mode: "seed", record: next, bridge, prompt: buildPrompt(bridge), sentMessages: bridge.messages };
		}
		return { mode: "seed", record, bridge, prompt: buildPrompt(bridge), sentMessages: bridge.messages };
	}
	if (record.systemHash === systemHash) {
		const next = await reseedRecord(piSessionId, process.cwd());
		return { mode: "seed", record: next, bridge, prompt: buildPrompt(bridge), sentMessages: bridge.messages };
	}
	return { mode: "none", bridge, prompt: buildPrompt(bridge), sentMessages: bridge.messages };
}

function applyUsage(model: Model<Api>, output: AssistantMessage, prompt: string, usage?: { input: number; output: number; cacheRead: number; cacheWrite: number }) {
	if (usage) {
		output.usage.input = usage.input;
		output.usage.output = usage.output;
		output.usage.cacheRead = usage.cacheRead;
		output.usage.cacheWrite = usage.cacheWrite;
		output.usage.totalTokens = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
		calculateCost(model, output.usage);
		return;
	}
	const estimate = Math.max(1, Math.ceil(prompt.length / 4));
	output.usage.input = estimate;
	output.usage.output = Math.max(1, Math.ceil((output.content.find((part) => part.type === "text")?.text ?? "").length / 4));
	output.usage.totalTokens = output.usage.input + output.usage.output;
	calculateCost(model, output.usage);
}

/** token-speed.ts reads this shared entry (same key mistral-vibe-cli uses). */
const TURN_STATS_KEY = Symbol.for("my-pi.vibe.turn-stats");
const SPEED_MIN_MS = 200;
const SPEED_MIN_TOKENS = 16;

/**
 * Replace the SDK's stale per-message output_tokens with the streamed count and
 * publish a generation rate (message_start..message_stop, no spawn or tool wait).
 */
async function settleSpeed(
	turn: ActiveBridgeTurn,
	model: Model<Api>,
	output: AssistantMessage,
): Promise<void> {
	// The tool_use snapshot can arrive just before its message_stop.
	const deadline = Date.now() + 500;
	while (turn.callOpen && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
	const sample = turn.takeSpeedSample();
	const { ms } = sample;
	let tokens = sample.tokens;
	let source = "stream";
	const transcript = turn.transcript;
	if (transcript && sample.ids.length > 0) {
		// Claude's transcript holds the final count; it may land just after the
		// result message, so poll briefly. Falls back to the streamed count.
		const until = Date.now() + 600;
		for (;;) {
			const fromFile = await readClaudeOutputTokens(transcript.claudeSessionId, transcript.cwd, sample.ids);
			if (fromFile !== undefined) {
				tokens = fromFile;
				source = "jsonl";
				break;
			}
			if (Date.now() >= until) break;
			await new Promise((r) => setTimeout(r, 60));
		}
	}
	if (tokens > 0) {
		output.usage.output = tokens;
		output.usage.totalTokens = output.usage.input + tokens + output.usage.cacheRead + output.usage.cacheWrite;
		calculateCost(model, output.usage);
	}
	if (ms >= SPEED_MIN_MS && tokens >= SPEED_MIN_TOKENS) {
		const rate = tokens / (ms / 1000);
		(globalThis as Record<symbol, unknown>)[TURN_STATS_KEY] = { rate, at: Date.now() };
		logBridge("speed_sample", `${turn.key} src=${source} tokens=${tokens} streamed=${sample.tokens} ms=${ms} rate=${rate.toFixed(1)}`);
	} else {
		logBridge("speed_skip", `${turn.key} src=${source} tokens=${tokens} ms=${ms}`);
	}
}

export function streamClaudeSdk(
	model: Model<Api>,
	context: TranscriptContext,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();

	void (async () => {
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
		let currentTurn: ActiveBridgeTurn | undefined;
		// /claude-sdk-refresh and shutdown bump the session epoch; a cycle that
		// started before the bump must not write the mirror record afterwards.
		const entrySessionId = getActivePiSessionId();
		const entryEpoch = getSessionEpoch(entrySessionId);
		const stale = () => entrySessionId !== undefined && getSessionEpoch(entrySessionId) !== entryEpoch;
		const abortController = new AbortController();
		const onAbort = () => abortController.abort();
		options?.signal?.addEventListener("abort", onAbort, { once: true });

		let idleTimer: ReturnType<typeof setTimeout> | undefined;
		const bumpIdle = () => {
			if (idleTimer) clearTimeout(idleTimer);
			idleTimer = setTimeout(() => abortController.abort(), idleMs());
		};

		try {
			const bridge = bridgeContext(context);
			const piSessionId = getActivePiSessionId();
			const capability = isCapabilityCall(options) ? String(options?.metadata?.capability) : undefined;
			const regKey = registryKey(piSessionId, capability);
			const hasTools = bridge.tools.length > 0;
			const mainTurn = Boolean(piSessionId && !capability && hasTools);

			if (!mainTurn) {
				// One-shot: capability turns and no-tools main turns.
				mirror = { mode: "none", bridge, prompt: buildPrompt(bridge), sentMessages: bridge.messages };
				stream.push({ type: "start", partial: output });
				const sdkOptions: SdkOptions = buildQueryOptions({
					modelId: model.id,
					reasoning: options?.reasoning,
					thinkingLevelMap: model.thinkingLevelMap,
					systemPrompt: bridgeSystemPrompt(bridge.tools, bridge.systemPrompt),
					mode: "none",
					cwd: process.cwd(),
					abortController,
				});
				const q = query({ prompt: mirror.prompt, options: sdkOptions });
				const accum: { text: string; thinking: string; isError: boolean; sessionId?: string } = {
					text: "",
					thinking: "",
					isError: false,
				};
				bumpIdle();
				let thinkingIndex: number | undefined;
				let textIndex: number | undefined;
				const openThinking = new Map<number, number>();
				for await (const message of q) {
					bumpIdle();
					handleOneShotMessage(message, {
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
					});
				}
				if (thinkingIndex !== undefined) {
					const part = output.content[thinkingIndex];
					if (part?.type === "thinking") {
						stream.push({ type: "thinking_end", contentIndex: thinkingIndex, content: part.thinking, partial: output });
					}
				}
				if (textIndex !== undefined) {
					const part = output.content[textIndex];
					if (part?.type === "text") {
						stream.push({ type: "text_end", contentIndex: textIndex, content: part.text, partial: output });
					}
				}
				if (accum.isError) throw new Error(accum.text || "claude-agent-sdk returned an error result");
				if (!output.content.some((part) => part.type === "text")) {
					const contentIndex = output.content.length;
					output.content.push({ type: "text", text: accum.text });
					stream.push({ type: "text_start", contentIndex, partial: output });
					if (accum.text) {
						stream.push({ type: "text_delta", contentIndex, delta: accum.text, partial: output });
					}
					stream.push({ type: "text_end", contentIndex, content: accum.text, partial: output });
				}
				applyUsage(model, output, mirror.prompt, undefined);
				stream.push({ type: "done", reason: "stop", message: output });
				stream.end();
				if (piSessionId && !capability && !stale()) await noteMode(piSessionId, "none");
				return;
			}

			if (!regKey) throw new Error("claude-code-sdk: main turn without a session key");

			// ----------------------------------------------------------------
			// Main session turn: attach a cycle to the active SDK drain.
			// ----------------------------------------------------------------
			let turn = getActiveTurn(regKey);
			if (!turn) {
				mirror = await resolveMirror(context, options);
				turn = new ActiveBridgeTurn(regKey);
				turn.onActivity = bumpIdle;
				const drainAbort = new AbortController();
				turn.abortHook = () => drainAbort.abort();
				currentTurn = turn;
				const onCycleAbort = () => turn!.abort();
				abortController.signal.addEventListener("abort", onCycleAbort, { once: true });
				const started = await startDrain(turn, bridge, mirror, model, options, drainAbort);
				if (!started) {
					// Session loss on the first drain: reseed once and retry.
					if (mirror.record) {
						const next = await reseedRecord(mirror.record.piSessionId, process.cwd());
						mirror = { ...mirror, mode: "seed", record: next, prompt: buildPrompt(bridge), sentMessages: bridge.messages };
					}
					const retry = await startDrain(turn, bridge, mirror, model, options, drainAbort);
					if (!retry) throw new Error("claude-code-sdk: drain failed to start after reseed");
				}
				if (mirror.mode !== "none" && mirror.record) {
					turn.transcript = { claudeSessionId: mirror.record.claudeSessionId, cwd: mirror.record.cwd || process.cwd() };
				}
				setActiveTurn(regKey, turn);
				logBridge("turn_start", `${regKey} mode=${mirror.mode} tools=${bridge.tools.length}`);
			} else {
				currentTurn = turn;
				mirror = { mode: "resume", bridge, prompt: buildPrompt(bridge), sentMessages: bridge.messages };
			}

			// Pre-work: Pi's toolResult messages resolve pending CLI handlers.
			turn.resolveOutcomes(bridge.messages as Array<{ role?: string; toolCallId?: string; isError?: boolean; content?: unknown }>);

			// Cycle: stream live until this assistant message ends.
			let cycleEnd: "toolUse" | "stop" | undefined;
			let thinkingIndex: number | undefined;
			let textIndex: number | undefined;
			const openThinking = new Map<number, number>();

			const emitToolUses = () => {
				const uses = turn!.unemittedUses();
				if (uses.length === 0) return;
				for (const use of uses) {
					const toolCall: ToolCall = {
						type: "toolCall",
						id: use.nativeId,
						name: piToolName(use.name),
						arguments: (use.input ?? {}) as Record<string, any>,
					};
					const toolIndex = output.content.length;
					output.content.push(toolCall);
					stream.push({ type: "toolcall_start", contentIndex: toolIndex, partial: output });
					stream.push({
						type: "toolcall_delta",
						contentIndex: toolIndex,
						delta: JSON.stringify(toolCall.arguments, null, 2),
						partial: output,
					});
					stream.push({ type: "toolcall_end", contentIndex: toolIndex, toolCall, partial: output });
					turn!.markEmitted(use.nativeId);
				}
				cycleEnd = "toolUse";
			};

			const detach = turn.attach((message: SDKMessage) => {
				if (cycleEnd) return;
				if (message.type === "stream_event") {
					const event = (message as unknown as { event?: Record<string, unknown> }).event;
					if (!event || typeof event !== "object") return;
					const eventType = event.type as string;
					if (eventType === "content_block_start") {
						const block = event.content_block as { type?: string; thinking?: string; text?: string } | undefined;
						const index = event.index as number;
						if (block?.type === "thinking") {
							let ti = thinkingIndex;
							if (ti === undefined) {
								ti = output.content.length;
								output.content.push({ type: "thinking", thinking: block.thinking ?? "" });
								thinkingIndex = ti;
								stream.push({ type: "thinking_start", contentIndex: ti, partial: output });
							}
							openThinking.set(index, ti);
							if (block.thinking) appendThinking(output, stream, ti, block.thinking);
						} else if (block?.type === "text") {
							let tx = textIndex;
							if (tx === undefined) {
								tx = output.content.length;
								output.content.push({ type: "text", text: block.text ?? "" });
								textIndex = tx;
								stream.push({ type: "text_start", contentIndex: tx, partial: output });
							}
							if (block.text) appendText(output, stream, tx, block.text);
						}
					} else if (eventType === "content_block_delta") {
						const delta = event.delta as { type?: string; thinking?: string; text?: string } | undefined;
						const index = event.index as number;
						if (delta?.type === "thinking_delta" && delta.thinking) {
							const ti = openThinking.get(index) ?? thinkingIndex;
							if (ti !== undefined) appendThinking(output, stream, ti, delta.thinking);
						} else if (delta?.type === "text_delta" && delta.text) {
							let tx = textIndex;
							if (tx === undefined) {
								tx = output.content.length;
								output.content.push({ type: "text", text: "" });
								textIndex = tx;
								stream.push({ type: "text_start", contentIndex: tx, partial: output });
							}
							appendText(output, stream, tx, delta.text);
						}
					} else if (eventType === "content_block_stop") {
						openThinking.delete(event.index as number);
					}
					return;
				}
				if (message.type === "assistant") {
					// Snapshot: the CLI executes tools now. Emit any new tool_use
					// blocks as real Pi toolCall parts and end with toolUse.
					emitToolUses();
					return;
				}
				if (message.type === "result") {
					if (turn!.final?.isError) {
						cycleEnd = "stop";
						return;
					}
					// Result without pending uses: final text reply.
					emitToolUses();
					cycleEnd = "stop";
				}
			});

			stream.push({ type: "start", partial: output });

			// The drain completes only when the SDK turn ends (all handlers
			// resolved). Wait for the cycle end conditions, checking the
			// buffered final state.
			await new Promise<void>((resolve) => {
				const poll = () => {
					if (cycleEnd) return resolve();
					if (turn!.final) {
						if (turn!.final.isError) return resolve();
						if (turn!.unemittedUses().length > 0) emitToolUses();
						else cycleEnd = "stop";
						return resolve();
					}
					if (turn!.aborted) return resolve();
					if (abortController.signal.aborted) {
						turn!.abort();
						return resolve();
					}
					setTimeout(poll, 50);
				};
				poll();
			});
			detach();

			if (thinkingIndex !== undefined) {
				const part = output.content[thinkingIndex];
				if (part?.type === "thinking") {
					stream.push({ type: "thinking_end", contentIndex: thinkingIndex, content: part.thinking, partial: output });
				}
			}
			if (textIndex !== undefined) {
				const part = output.content[textIndex];
				if (part?.type === "text") {
					stream.push({ type: "text_end", contentIndex: textIndex, content: part.text, partial: output });
				}
			}

			const final = turn.final;
			if (turn.aborted || (abortController.signal.aborted && cycleEnd !== "toolUse")) {
				turn.abort();
				clearActiveTurn(regKey, turn);
				output.stopReason = "aborted";
				output.errorMessage = final?.errorMessage ?? "claude-code-sdk turn aborted";
				stream.push({ type: "error", reason: "aborted", error: output });
				stream.end();
				if (piSessionId && !stale()) await reseedRecord(piSessionId, process.cwd()).catch(() => undefined);
				return;
			}

			if (cycleEnd === "toolUse") {
				if (mirror.mode === "seed" && mirror.record && piSessionId && !stale()) {
					// Claim the Claude UUID before Pi continues (next cycle or
					// a queued user message). Full syncedCount updates on stop.
					mirror.record.initialized = true;
					mirror.record.lastMode = "seed";
					mirror.record.lastTurnAt = Date.now();
					mirror.record.systemHash = hashSystemPrompt(
						bridgeConfigHashMaterial(bridge.systemPrompt, bridge.tools),
					);
					await saveRecord(mirror.record);
					mirror = { ...mirror, mode: "resume" };
				}
				// Per-call window usage so Pi's mid-turn context estimate stays honest.
				if (turn.lastCallUsage) {
					applyUsage(model, output, mirror.prompt, turn.lastCallUsage);
				}
				await settleSpeed(turn, model, output);
				output.stopReason = "toolUse";
				stream.push({ type: "done", reason: "toolUse", message: output });
				stream.end();
				return;
			}

			// Final reply: deliver text (snapshot fallback), usage, bookkeeping.
			if (final?.isError) {
				clearActiveTurn(regKey, turn);
				output.stopReason = "error";
				output.errorMessage = final.errorMessage ?? final.text ?? "claude-agent-sdk returned an error result";
				stream.push({ type: "error", reason: "error", error: output });
				stream.end();
				if (piSessionId && !stale()) await reseedRecord(piSessionId, process.cwd()).catch(() => undefined);
				return;
			}

			if (!output.content.some((part) => part.type === "text")) {
				const text = final?.text ?? "";
				const contentIndex = output.content.length;
				output.content.push({ type: "text", text });
				stream.push({ type: "text_start", contentIndex, partial: output });
				if (text) {
					stream.push({ type: "text_delta", contentIndex, delta: text, partial: output });
				}
				stream.push({ type: "text_end", contentIndex, content: text, partial: output });
			}
			applyUsage(model, output, mirror.prompt, final?.usage);
			await settleSpeed(turn, model, output);

			// Persist mirror BEFORE stream.end(): Pi may start the next
			// streamSimple as soon as this stream ends; seeding the same
			// Claude UUID twice yields "Session ID already in use".
			if (!stale()) {
				const record = await ensureRecord(piSessionId!, process.cwd());
				await markSeeded(
					record,
					bridge.messages,
					bridgeConfigHashMaterial(bridge.systemPrompt, bridge.tools),
					"resume",
					final?.text,
				);
			}

			stream.push({ type: "done", reason: "stop", message: output });
			stream.end();
			clearActiveTurn(regKey, turn);
			logBridge("turn_end", `${regKey} isError=false`);
		} catch (error) {
			logBridge("stream_error", `${error instanceof Error ? error.message : String(error)}`);
			const failedKey = regKeyOf(bridgeContext(context), options);
			if (failedKey && currentTurn) {
				clearActiveTurn(failedKey, currentTurn);
				currentTurn.abort("claude-code-sdk stream error");
			}
			if (mirror?.record && mirror.mode !== "none" && getActivePiSessionId() && !stale()) {
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

function regKeyOf(_bridge: BridgeContext, options?: SimpleStreamOptions): string | undefined {
	return registryKey(getActivePiSessionId(), isCapabilityCall(options) ? String(options?.metadata?.capability) : undefined);
}

async function startDrain(
	turn: ActiveBridgeTurn,
	bridge: BridgeContext,
	mirror: Mirror,
	model: Model<Api>,
	options: SimpleStreamOptions | undefined,
	abortController: AbortController,
): Promise<boolean> {
	const sdkOptions: SdkOptions = buildQueryOptions({
		modelId: model.id,
		reasoning: options?.reasoning,
		thinkingLevelMap: model.thinkingLevelMap,
		systemPrompt: bridgeSystemPrompt(bridge.tools, bridge.systemPrompt),
		mode: mirror.mode,
		claudeSessionId: mirror.record?.claudeSessionId,
		cwd: mirror.record?.cwd || process.cwd(),
		abortController,
		mcpServers: { pi: buildPiMcpServer(bridge.tools, turn) },
	});
	try {
		const q = query({ prompt: mirror.prompt, options: sdkOptions });
		turn.start(q);
		turn.resolveOutcomes(bridge.messages as Array<{ role?: string; toolCallId?: string; isError?: boolean; content?: unknown }>);
		return true;
	} catch (error) {
		if (!isSessionLoss(error)) throw error;
		logBridge("drain_session_loss", `${turn.key} ${error instanceof Error ? error.message : String(error)}`);
		return false;
	}
}

type OneShotState = {
	accum: { text: string; thinking: string; isError: boolean; sessionId?: string };
	output: AssistantMessage;
	stream: AssistantMessageEventStream;
	openThinking: Map<number, number>;
	getThinkingIndex: () => number | undefined;
	setThinkingIndex: (i: number | undefined) => void;
	getTextIndex: () => number | undefined;
	setTextIndex: (i: number | undefined) => void;
};

function handleOneShotMessage(message: SDKMessage, state: OneShotState): void {
	if (message.type === "system" && (message as { subtype?: string }).subtype === "init") {
		const sessionId = (message as { session_id?: string }).session_id;
		if (sessionId) state.accum.sessionId = sessionId;
		return;
	}
	if (message.type === "stream_event") {
		const event = (message as unknown as { event?: Record<string, unknown> }).event;
		if (!event || typeof event !== "object") return;
		const eventType = event.type as string;
		if (eventType === "content_block_start") {
			const block = event.content_block as { type?: string; thinking?: string; text?: string } | undefined;
			const index = event.index as number;
			if (block?.type === "thinking") {
				let ti = state.getThinkingIndex();
				if (ti === undefined) {
					ti = state.output.content.length;
					state.output.content.push({ type: "thinking", thinking: block.thinking ?? "" });
					state.setThinkingIndex(ti);
					state.stream.push({ type: "thinking_start", contentIndex: ti, partial: state.output });
				}
				state.openThinking.set(index, ti);
				if (block.thinking) appendThinking(state.output, state.stream, ti, block.thinking);
			} else if (block?.type === "text") {
				let tx = state.getTextIndex();
				if (tx === undefined) {
					tx = state.output.content.length;
					state.output.content.push({ type: "text", text: block.text ?? "" });
					state.setTextIndex(tx);
					state.stream.push({ type: "text_start", contentIndex: tx, partial: state.output });
				}
				if (block.text) appendText(state.output, state.stream, tx, block.text);
			}
		} else if (eventType === "content_block_delta") {
			const delta = event.delta as { type?: string; thinking?: string; text?: string } | undefined;
			const index = event.index as number;
			if (delta?.type === "thinking_delta" && delta.thinking) {
				const ti = state.openThinking.get(index) ?? state.getThinkingIndex();
				if (ti !== undefined) appendThinking(state.output, state.stream, ti, delta.thinking);
			} else if (delta?.type === "text_delta" && delta.text) {
				let tx = state.getTextIndex();
				if (tx === undefined) {
					tx = state.output.content.length;
					state.output.content.push({ type: "text", text: "" });
					state.setTextIndex(tx);
					state.stream.push({ type: "text_start", contentIndex: tx, partial: state.output });
				}
				appendText(state.output, state.stream, tx, delta.text);
			}
		} else if (eventType === "content_block_stop") {
			state.openThinking.delete(event.index as number);
		}
		return;
	}
	if (message.type === "result") {
		const result = message as {
			subtype?: string;
			is_error?: boolean;
			result?: string;
			session_id?: string;
		};
		if (result.session_id) state.accum.sessionId = result.session_id;
		state.accum.isError = Boolean(result.is_error || result.subtype === "error");
		if (typeof result.result === "string" && result.result && !state.accum.text) {
			state.accum.text = result.result;
		}
	}
}

function appendThinking(output: AssistantMessage, stream: AssistantMessageEventStream, index: number, delta: string): void {
	const part = output.content[index];
	if (!part || part.type !== "thinking") return;
	part.thinking += delta;
	stream.push({ type: "thinking_delta", contentIndex: index, delta, partial: output });
}

function appendText(output: AssistantMessage, stream: AssistantMessageEventStream, index: number, delta: string): void {
	const part = output.content[index];
	if (!part || part.type !== "text") return;
	part.text += delta;
	stream.push({ type: "text_delta", contentIndex: index, delta, partial: output });
}