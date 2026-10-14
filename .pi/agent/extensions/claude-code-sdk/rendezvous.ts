/**
 * Active Claude Code SDK turn: one query() drain shared by every Pi provider
 * cycle of one user message.
 *
 * The model's tool_use blocks are parsed here (native ids). MCP handlers
 * rendezvous with parsed uses (FIFO by name) and await the Pi outcome for
 * their native id. Provider cycles attach, resolve outcomes from the Pi
 * transcript's toolResult messages, stream thinking/text deltas live, emit
 * unemitted tool_use blocks as real Pi toolCall parts (stopReason toolUse,
 * so Pi executes them model-issued through its own full pipeline), and
 * deliver the SDK result when the turn ends.
 */
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

/** Breadcrumb log for bridge debugging: ~/.pi/agent/claude-code-sdk/bridge.log */
export function logBridge(event: string, data?: unknown): void {
	try {
		const configured = process.env.PI_CODING_AGENT_DIR?.trim();
		const agentDir = configured
			? (isAbsolute(configured) ? configured : resolve(process.cwd(), configured))
			: join(homedir(), ".pi", "agent");
		const dir = join(agentDir, "claude-code-sdk");
		mkdirSync(dir, { recursive: true });
		const line = data === undefined ? event : `${event} ${typeof data === "string" ? data : JSON.stringify(data)}`;
		appendFileSync(join(dir, "bridge.log"), `${new Date().toISOString()} ${line}\n`);
	} catch {
		/* never break the bridge for logging */
	}
}

export type McpResultContent = Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;

export type ParsedUse = { nativeId: string; name: string; input: Record<string, unknown> };

export type TurnFinal = {
	text: string;
	thinking: string;
	sessionId?: string;
	isError: boolean;
	errorMessage?: string;
	usage?: { input: number; output: number; cacheRead: number; cacheWrite: number };
};

const BUFFER_CAP = 400;

/** Claude Code prefixes in-process MCP tools as mcp__<server>__<tool>. */
export const PI_MCP_PREFIX = "mcp__pi__";

export function piToolName(mcpName: string): string {
	return mcpName.startsWith(PI_MCP_PREFIX) ? mcpName.slice(PI_MCP_PREFIX.length) : mcpName;
}

function safeParseJson(raw: string): Record<string, unknown> {
	try {
		const value = JSON.parse(raw);
		return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

/** Map Anthropic/SDK usage fields into Pi's usage shape. */
function parseSdkUsage(raw: Record<string, unknown> | undefined): TurnFinal["usage"] {
	if (!raw) return undefined;
	const num = (key: string) => {
		const value = raw[key];
		return typeof value === "number" && Number.isFinite(value) ? value : 0;
	};
	return {
		input: num("input_tokens"),
		output: num("output_tokens"),
		cacheRead: num("cache_read_input_tokens"),
		cacheWrite: num("cache_creation_input_tokens"),
	};
}

export class ActiveBridgeTurn {
	readonly key: string;
	/** Called on every SDK message; resets the idle watchdog. */
	onActivity?: () => void;

	private readonly subs = new Set<(message: SDKMessage) => void>();
	private readonly buffer: SDKMessage[] = [];
	/** First buffer index not yet offered to a cycle attach. */
	private bufferStart = 0;
	private readonly openUses = new Map<number, { nativeId: string; name: string; json: string }>();
	/** tool_use blocks in arrival order, across the whole SDK turn. */
	readonly parsedUses: ParsedUse[] = [];
	/** native ids whose Pi outcome was delivered back to the CLI handler. */
	readonly resolvedUses = new Set<string>();

	private readonly handlerWaiters: Array<{
		name: string;
		release: (use: ParsedUse) => void;
		/** Resolve the parked handler with a terminal outcome (abort). */
		cancel: (outcome: { content: McpResultContent; isError: boolean }) => void;
	}> = [];
	private readonly outcomeWaiters = new Map<string, (outcome: { content: McpResultContent; isError: boolean }) => void>();
	/** Outcomes that arrived before their handler registered, by nativeId. */
	private readonly earlyOutcomes = new Map<string, { content: McpResultContent; isError: boolean }>();

	final: TurnFinal | undefined;
	/**
	 * Per-call context-window usage from the latest assistant message.
	 * SDK result.usage aggregates every round-trip in the turn — that sum is
	 * for cost, not window size. Pi compaction uses totalTokens as window size.
	 */
	lastCallUsage: TurnFinal["usage"];
	aborted = false;
	/** Claude transcript backing this turn; undefined for persistSession:false turns. */
	transcript?: { claudeSessionId: string; cwd: string };
	/** Stops the SDK drain (set by the stream layer). Called once by abort(). */
	abortHook?: () => void;
	/** Resolves when the SDK pump has ended (or immediately if never started). */
	readonly pumpSettled: Promise<void>;

	private closed = false;
	private started = false;

	// Generation speed: one window per API call (message_start..message_stop).
	// SDK `assistant` snapshots carry a stale output_tokens, so the real count
	// comes from the stream's message_delta usage (chars/4 as fallback).
	private callStartAt: number | undefined;
	private callTokens = 0;
	private callChars = 0;
	private callId: string | undefined;
	/** API message ids of completed calls since the last take; keys into Claude's jsonl. */
	private speedIds: string[] = [];
	private speedTokens = 0;
	private speedMs = 0;
	private resolvePump!: () => void;

	constructor(key: string) {
		this.key = key;
		this.pumpSettled = new Promise<void>((resolvePump) => {
			this.resolvePump = resolvePump;
		});
	}

	get isClosed(): boolean {
		return this.closed;
	}

	/** True while an API call is streaming (message_start seen, message_stop not yet). */
	get callOpen(): boolean {
		return this.callStartAt !== undefined;
	}

	/** Completed-call tokens and generation milliseconds since the last take. */
	takeSpeedSample(): { tokens: number; ms: number; ids: string[] } {
		const sample = { tokens: this.speedTokens, ms: this.speedMs, ids: this.speedIds };
		this.speedTokens = 0;
		this.speedMs = 0;
		this.speedIds = [];
		return sample;
	}

	private trackSpeed(type: string, event: Record<string, unknown>): void {
		if (type === "message_start") {
			this.callStartAt = Date.now();
			this.callTokens = 0;
			this.callChars = 0;
			const id = (event.message as { id?: unknown } | undefined)?.id;
			this.callId = typeof id === "string" ? id : undefined;
		} else if (type === "content_block_delta") {
			const delta = event.delta as { text?: string; thinking?: string; partial_json?: string } | undefined;
			this.callChars += (delta?.text?.length ?? 0) + (delta?.thinking?.length ?? 0) + (delta?.partial_json?.length ?? 0);
		} else if (type === "message_delta") {
			const out = (event.usage as { output_tokens?: unknown } | undefined)?.output_tokens;
			if (typeof out === "number" && Number.isFinite(out)) this.callTokens = out;
		} else if (type === "message_stop" && this.callStartAt !== undefined) {
			const tokens = this.callTokens > 0 ? this.callTokens : Math.ceil(this.callChars / 4);
			this.speedTokens += tokens;
			this.speedMs += Date.now() - this.callStartAt;
			if (this.callId) this.speedIds.push(this.callId);
			this.callStartAt = undefined;
		}
	}

	/**
	 * Terminate the turn: stop the drain and release every waiting MCP handler
	 * with an error outcome so none sits on the 600s tool timeout. Idempotent.
	 */
	abort(reason = "claude-code-sdk turn aborted"): void {
		if (this.closed) return;
		this.closed = true;
		this.aborted = true;
		this.final ??= { text: "", thinking: "", isError: true, errorMessage: reason };
		const outcome = { content: [{ type: "text" as const, text: reason }], isError: true };
		for (const resolveOutcome of [...this.outcomeWaiters.values()]) resolveOutcome(outcome);
		this.outcomeWaiters.clear();
		for (const waiter of this.handlerWaiters.splice(0)) waiter.cancel(outcome);
		this.earlyOutcomes.clear();
		try {
			this.abortHook?.();
		} catch {
			/* drain already gone */
		}
		if (!this.started) this.resolvePump();
		logBridge("turn_abort", `${this.key} ${reason}`);
	}

	/** Pump the SDK drain into this turn; runs until the query ends or throws. */
	start(drain: AsyncIterable<SDKMessage>): void {
		this.started = true;
		void (async () => {
			try {
				for await (const message of drain) {
					this.onActivity?.();
					this.handle(message);
				}
			} catch (error) {
				logBridge("pump_error", `${this.key} ${error instanceof Error ? error.message : String(error)}`);
				this.final ??= {
					text: "",
					thinking: "",
					isError: true,
					errorMessage: error instanceof Error ? error.message : String(error),
				};
			} finally {
				this.resolvePump();
			}
		})();
	}

	private handle(message: SDKMessage): void {
		if (this.closed) return; // late SDK output must not overwrite the abort state
		this.buffer.push(message);
		if (this.buffer.length > BUFFER_CAP) {
			const drop = this.buffer.length - BUFFER_CAP;
			this.buffer.splice(0, drop);
			this.bufferStart = Math.max(0, this.bufferStart - drop);
		}

		if (message.type === "stream_event") {
			const event = (message as unknown as { event?: Record<string, unknown> }).event;
			if (event && typeof event === "object") {
				const type = event.type as string;
				this.trackSpeed(type, event);
				if (type === "content_block_start") {
					const block = event.content_block as { type?: string; id?: string; name?: string } | undefined;
					if (block?.type === "tool_use" && typeof block.id === "string") {
						this.openUses.set(event.index as number, {
							nativeId: block.id,
							name: String(block.name ?? ""),
							json: "",
						});
					}
				} else if (type === "content_block_delta") {
					const delta = event.delta as { type?: string; partial_json?: string } | undefined;
					const open = this.openUses.get(event.index as number);
					if (delta?.type === "input_json_delta" && open && typeof delta.partial_json === "string") {
						open.json += delta.partial_json;
					}
				} else if (type === "content_block_stop") {
					const open = this.openUses.get(event.index as number);
					if (open) {
						this.openUses.delete(event.index as number);
						this.pushUse({ nativeId: open.nativeId, name: open.name, input: safeParseJson(open.json) });
					}
				}
			}
		}

		if (message.type === "assistant") {
			const assistant = message as unknown as {
				message?: {
					content?: Array<{ type: string; id?: string; name?: string; input?: Record<string, unknown> }>;
					usage?: Record<string, unknown>;
				};
			};
			const content = assistant.message?.content;
			for (const block of content ?? []) {
				if (block.type === "tool_use" && typeof block.id === "string") {
					this.pushUse({ nativeId: block.id, name: String(block.name ?? ""), input: (block.input ?? {}) as Record<string, unknown> });
				}
			}
			const callUsage = parseSdkUsage(assistant.message?.usage);
			if (callUsage && (callUsage.input + callUsage.output + callUsage.cacheRead + callUsage.cacheWrite) > 0) {
				this.lastCallUsage = callUsage;
			}
		}

		if (message.type === "result") {
			const result = message as unknown as {
				subtype?: string;
				is_error?: boolean;
				result?: string;
				session_id?: string;
				usage?: Record<string, unknown>;
			};
			// Prefer last per-call usage for Pi compaction (window size).
			// result.usage is the turn aggregate and falsely trips compaction.
			const aggregate = parseSdkUsage(result.usage);
			const usage = this.lastCallUsage ?? aggregate;
			if (aggregate && this.lastCallUsage) {
				const aggTotal = aggregate.input + aggregate.output + aggregate.cacheRead + aggregate.cacheWrite;
				const callTotal = this.lastCallUsage.input + this.lastCallUsage.output + this.lastCallUsage.cacheRead + this.lastCallUsage.cacheWrite;
				if (aggTotal > callTotal * 2) {
					logBridge("usage_window", `${this.key} call=${callTotal} aggregate=${aggTotal} (using call)`);
				}
			}
			this.final = {
				text: typeof result.result === "string" ? result.result : "",
				thinking: "",
				sessionId: result.session_id,
				isError: Boolean(result.is_error || result.subtype === "error"),
				usage,
			};
		}

		for (const sub of [...this.subs]) sub(message);
	}

	private pushUse(use: ParsedUse): void {
		if (this.parsedUses.some((existing) => existing.nativeId === use.nativeId)) return;
		const normalized: ParsedUse = { ...use, name: piToolName(use.name) };
		this.parsedUses.push(normalized);
		logBridge("use_parsed", `${this.key} ${normalized.nativeId} ${normalized.name}`);
		// Release the first parked MCP handler waiting on this tool name.
		for (let i = 0; i < this.handlerWaiters.length; i++) {
			if (this.handlerWaiters[i].name === normalized.name) {
				const waiter = this.handlerWaiters.splice(i, 1)[0];
				waiter.release(normalized);
				return;
			}
		}
	}

	/**
	 * MCP handler entry: claim the parsed tool_use for this CLI call and await
	 * the Pi outcome (delivered by the next provider cycle's pre-work).
	 */
	nextOutcome(name: string): Promise<{ content: McpResultContent; isError: boolean }> {
		this.onActivity?.();
		const toolName = piToolName(name);
		logBridge("handler_claim", `${this.key} ${toolName}`);
		if (this.closed) {
			return Promise.resolve({ content: [{ type: "text", text: "claude-code-sdk turn aborted" }], isError: true });
		}
		return new Promise((resolveOutcome) => {
			const settle = (nativeId: string) => {
				const early = this.earlyOutcomes.get(nativeId);
				if (early) {
					// The outcome already arrived (cycle 2 pre-work ran first).
					this.earlyOutcomes.delete(nativeId);
					this.resolvedUses.add(nativeId);
					resolveOutcome(early);
					return;
				}
				this.outcomeWaiters.set(nativeId, resolveOutcome);
			};
			const register = (use: ParsedUse) => {
				if (this.outcomeWaiters.has(use.nativeId)) {
					// One handler per native id; never leave a duplicate pending.
					resolveOutcome({ content: [{ type: "text", text: "duplicate tool handler" }], isError: true });
					return;
				}
				settle(use.nativeId);
			};
			const buffered = this.parsedUses.find((use) => use.name === toolName && this.earlyOutcomes.has(use.nativeId));
			const queued = this.parsedUses.find(
				(use) => use.name === toolName && !this.outcomeWaiters.has(use.nativeId) && !this.resolvedUses.has(use.nativeId),
			);
			if (buffered) settle(buffered.nativeId);
			else if (queued) register(queued);
			else {
				logBridge("handler_park", `${this.key} ${toolName}`);
				this.handlerWaiters.push({ name: toolName, release: register, cancel: resolveOutcome });
			}
		});
	}

	/** Cycle pre-work: feed Pi toolResult messages back to pending CLI handlers. */
	resolveOutcomes(messages: Array<{ role?: string; toolCallId?: string; isError?: boolean; content?: unknown }>): void {
		if (this.closed) return;
		for (const message of messages) {
			if (message.role !== "toolResult") continue;
			const nativeId = message.toolCallId;
			if (!nativeId) continue;
			if (this.resolvedUses.has(nativeId) && !this.outcomeWaiters.has(nativeId)) continue;
			const content: McpResultContent = [];
			const raw = message.content;
			if (typeof raw === "string") {
				content.push({ type: "text", text: raw });
			} else if (Array.isArray(raw)) {
				for (const part of raw as Array<{ type: string; text?: string; data?: string; mimeType?: string }>) {
					if (part.type === "text" && part.text) content.push({ type: "text", text: part.text });
					else if (part.type === "image" && part.data) content.push({ type: "image", data: part.data, mimeType: part.mimeType ?? "image/png" });
				}
			}
			if (content.length === 0) content.push({ type: "text", text: "" });
			const outcome = { content, isError: Boolean(message.isError) };

			const resolveOutcome = this.outcomeWaiters.get(nativeId);
			if (!resolveOutcome) {
				// No handler yet (it registers on the CLI side, possibly after
				// this cycle's pre-work): buffer so its settle() picks it up.
				this.earlyOutcomes.set(nativeId, outcome);
				this.resolvedUses.add(nativeId);
				logBridge("outcome_buffered", `${this.key} ${nativeId} isError=${outcome.isError}`);
				// If a handler is already parked on this tool name, release it
				// so settle() drains earlyOutcomes (it will not call nextOutcome again).
				const use = this.parsedUses.find((u) => u.nativeId === nativeId);
				if (use) {
					for (let i = 0; i < this.handlerWaiters.length; i++) {
						if (this.handlerWaiters[i].name === use.name) {
							const waiter = this.handlerWaiters.splice(i, 1)[0];
							waiter.release(use);
							break;
						}
					}
				}
				continue;
			}
			this.outcomeWaiters.delete(nativeId);
			this.resolvedUses.add(nativeId);
			resolveOutcome(outcome);
			logBridge("outcome_resolved", `${this.key} ${nativeId} isError=${outcome.isError}`);
		}
	}


	/**
	 * Cycle attach: replay only messages not yet offered to a prior cycle,
	 * then stream live. Detach advances the watermark so the next cycle does
	 * not re-emit earlier text/thinking deltas (which would duplicate in Pi).
	 */
	attach(onMessage: (message: SDKMessage) => void): () => void {
		this.subs.add(onMessage);
		for (let i = this.bufferStart; i < this.buffer.length; i++) {
			onMessage(this.buffer[i]);
		}
		return () => {
			this.subs.delete(onMessage);
			this.bufferStart = this.buffer.length;
		};
	}

	/** Tool uses not yet emitted to Pi, in order. */
	unemittedUses(): ParsedUse[] {
		return this.parsedUses.filter((use) => !this.resolvedUses.has(use.nativeId) && !this.emittedUses.has(use.nativeId));
	}

	readonly emittedUses = new Set<string>();

	markEmitted(nativeId: string): void {
		this.emittedUses.add(nativeId);
	}
}

// ---------------------------------------------------------------------------
// Registry: regKey -> active turn. One active main-session SDK turn per Pi
// session; capability turns stay one-shot (separate fresh sessions).
// ---------------------------------------------------------------------------

export function registryKey(piSessionId: string | undefined, capability: string | undefined): string | undefined {
	if (!piSessionId) return undefined;
	return `${piSessionId}|${capability ?? "main"}`;
}

const turns = new Map<string, ActiveBridgeTurn>();

export function setActiveTurn(key: string, turn: ActiveBridgeTurn): void {
	turns.set(key, turn);
}

/**
 * Compare-and-delete: a stale cycle must never remove a newer turn that was
 * registered under the same key after a refresh.
 */
export function clearActiveTurn(key: string, turn: ActiveBridgeTurn): void {
	if (turns.get(key) === turn) turns.delete(key);
}

/** Per Pi session counter bumped by clearSessionTurns; guards stale record writes. */
const sessionEpochs = new Map<string, number>();

export function getSessionEpoch(piSessionId: string | undefined): number {
	return piSessionId ? (sessionEpochs.get(piSessionId) ?? 0) : 0;
}

export function getActiveTurn(key: string): ActiveBridgeTurn | undefined {
	return turns.get(key);
}

/**
 * Abort and forget all turn state for a Pi session (shutdown, refresh).
 * Synchronous part (epoch bump, unregister, abort) finishes before the first
 * await, so fire-and-forget callers are safe. The returned promise resolves
 * when the aborted drains have stopped, or after waitMs.
 */
export async function clearSessionTurns(piSessionId: string, waitMs = 2000): Promise<void> {
	sessionEpochs.set(piSessionId, getSessionEpoch(piSessionId) + 1);
	const aborted: ActiveBridgeTurn[] = [];
	for (const [key, turn] of [...turns]) {
		if (!key.startsWith(`${piSessionId}|`)) continue;
		turns.delete(key);
		turn.abort("claude-code-sdk session refreshed");
		aborted.push(turn);
	}
	if (aborted.length === 0) return;
	let timer: ReturnType<typeof setTimeout> | undefined;
	await Promise.race([
		Promise.all(aborted.map((turn) => turn.pumpSettled)),
		new Promise<void>((resolveWait) => {
			timer = setTimeout(resolveWait, waitMs);
		}),
	]);
	if (timer) clearTimeout(timer);
}