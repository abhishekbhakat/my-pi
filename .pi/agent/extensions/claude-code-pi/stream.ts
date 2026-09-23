import { spawn } from "node:child_process";
import {
	calculateCost,
	createAssistantMessageEventStream,
	type Api,
	type AssistantMessage,
	type AssistantMessageEventStream,
	type ImageContent,
	type Message,
	type Model,
	type SimpleStreamOptions,
	type ToolCall,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import { buildClaudeArgs, claudeBin, describeStreamError, requestTimeoutMs, STDERR_LIMIT, type SessionArgMode } from "./cli.ts";
import {
	bridgeContext,
	buildDeltaPrompt,
	buildPrompt,
	buildStreamJsonInput,
	parseStreamJsonOutput,
	parseToolCalls,
	safeJson,
	selectSentMessages,
	type BridgeContext,
} from "./prompt.ts";
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

// Fatal CLI signatures: the Claude session named in the map is gone or taken.
// Only these justify throwing away the mapped session and reseeding.
const RESEED_SIGNATURES = ["already in use", "No conversation found"];

function isSessionLoss(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return RESEED_SIGNATURES.some((sig) => message.includes(sig));
}

// Capability calls are marked by capability-tools metadata. They decide their
// own context and tool set, so they must never seed or resume the main mirror.
function isCapabilityCall(options?: SimpleStreamOptions): boolean {
	return typeof options?.metadata?.capability === "string";
}

// Unmarked calls with a tool registry are normal Pi turns. Tool-free unmarked
// calls stay stateless; that covers cache warmup and other internal callers.
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

function applyUsage(model: Model<Api>, output: AssistantMessage, parsed: ReturnType<typeof parseStreamJsonOutput>, prompt: string) {
	if (parsed.usage) {
		output.usage.input = parsed.usage.input;
		output.usage.output = parsed.usage.output;
		output.usage.cacheRead = parsed.usage.cacheRead;
		output.usage.cacheWrite = parsed.usage.cacheWrite;
		output.usage.totalTokens =
			parsed.usage.input + parsed.usage.output + parsed.usage.cacheRead + parsed.usage.cacheWrite;
		calculateCost(model, output.usage);
		return;
	}
	const estimate = Math.max(1, Math.ceil(prompt.length / 4));
	output.usage.input = estimate;
	output.usage.output = Math.max(1, Math.ceil((parsed.text || "").length / 4));
	output.usage.totalTokens = output.usage.input + output.usage.output;
	calculateCost(model, output.usage);
}

// Images attached to the transcript slice actually sent this turn. Resume
// sends only new messages, so old user images are not re-attached.
function imagesFrom(messages: Message[]): ImageContent[] {
	return messages.flatMap((message) =>
		Array.isArray((message as { content?: unknown }).content)
			? (message as { content: Array<{ type: string; mimeType: string; data: string }> }).content
					.filter((item) => item.type === "image")
					.map((item) => ({ type: "image" as const, mimeType: item.mimeType, data: item.data }))
			: [],
	);
}

type Mirror = {
	mode: SessionArgMode;
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
	const systemHash = hashSystemPrompt(bridge.systemPrompt);
	if (
		record.initialized &&
		record.systemHash === systemHash &&
		canResume(record, bridge.messages)
	) {
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
		// Same conversation, prefix broke (/undo, compact): start a fresh mirror.
		const next = await reseedRecord(piSessionId, process.cwd());
		return { mode: "seed", record: next, bridge, prompt: buildPrompt(bridge), sentMessages: bridge.messages };
	}
	// Different system prompt (helper): stateless, mirror untouched.
	return { mode: "none", bridge, prompt: buildPrompt(bridge), sentMessages: bridge.messages };
}

export function streamClaudeCode(
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
		let stderr = "";
		let stdout = "";
		let settled = false;
		let timedOut = false;
		let timer: ReturnType<typeof setTimeout> | undefined;

		const runOnce = async () => {
			stderr = "";
			stdout = "";
			settled = false;
			timedOut = false;
			const images = imagesFrom(mirror!.sentMessages);
			const useStreamJson = images.length > 0;
			const child = spawn(
				claudeBin(),
				buildClaudeArgs({
					modelId: model.id,
					reasoning: options?.reasoning,
					thinkingLevelMap: model.thinkingLevelMap,
					useStreamJson,
					sessionMode: mirror!.mode,
					claudeSessionId: mirror!.record?.claudeSessionId,
					sessionName: mirror!.record ? `pi:${mirror!.record.piSessionId.slice(0, 8)}` : undefined,
				}),
				{
					stdio: ["pipe", "pipe", "pipe"],
					env: { ...process.env },
					cwd: mirror!.record?.cwd || process.cwd(),
				},
			);

			const abort = () => child.kill("SIGTERM");
			const timeout = requestTimeoutMs();
			timer = setTimeout(() => {
				timedOut = true;
				child.kill("SIGTERM");
			}, timeout);
			options?.signal?.addEventListener("abort", abort, { once: true });

			// Claude can exit before consuming a large stdin; EPIPE must not crash Pi.
			child.stdin!.on("error", () => undefined);
			child.stdin!.end(useStreamJson ? buildStreamJsonInput(images, mirror!.prompt) : mirror!.prompt);
			child.stdout!.setEncoding("utf8");
			child.stderr!.setEncoding("utf8");
			child.stdout!.on("data", (chunk: string) => {
				stdout += chunk;
			});
			child.stderr!.on("data", (chunk: string) => {
				stderr = (stderr + chunk).slice(-STDERR_LIMIT);
			});

			const code = await new Promise<number | null>((resolve, reject) => {
				child.on("error", reject);
				child.on("close", resolve);
			});
			settled = true;
			if (timer) clearTimeout(timer);
			options?.signal?.removeEventListener("abort", abort);

			if (options?.signal?.aborted) throw new Error("Request was aborted");
			if (timedOut) throw new Error(`claude -p timed out after ${timeout}ms`);
			// stream-json reports CLI failures in the stdout result event; stderr is often empty.
			if (code !== 0) {
				const detail = parseStreamJsonOutput(stdout).text.trim();
				throw new Error(stderr.trim() || detail || `claude -p exited with code ${code}`);
			}
		};

		try {
			// resolveMirror does disk IO; it must settle the stream on failure.
			mirror = await resolveMirror(context, options);
			stream.push({ type: "start", partial: output });
			try {
				await runOnce();
			} catch (error) {
				if (options?.signal?.aborted) throw error;
				if (
					mirror.record &&
					(mirror.mode === "seed" || mirror.mode === "resume") &&
					isSessionLoss(error)
				) {
					const record = await reseedRecord(mirror.record.piSessionId, process.cwd());
					mirror = { mode: "seed", record, bridge: mirror.bridge, prompt: buildPrompt(mirror.bridge), sentMessages: mirror.bridge.messages };
					await runOnce();
				} else {
					throw error;
				}
			}

			const parsed = parseStreamJsonOutput(stdout);
			if (parsed.sessionId && mirror.record && parsed.sessionId !== mirror.record.claudeSessionId) {
				throw new Error(
					`Claude Code used session ${parsed.sessionId}, expected ${mirror.record.claudeSessionId}; mirror state unknown.`,
				);
			}
			if (parsed.isError) throw new Error(parsed.text || "claude -p returned an error result");

			if (mirror.record) {
				await markSeeded(
					mirror.record,
					mirror.bridge.messages,
					mirror.bridge.systemPrompt,
					mirror.mode,
					// Same order and join as assistantText() so skipRecordedReply matches.
					[parsed.thinking, parsed.text].filter(Boolean).join("\n") || undefined,
				);
			} else if (mirror.mode === "none") {
				const piSessionId = getActivePiSessionId();
				if (piSessionId) await noteMode(piSessionId, "none");
			}

			applyUsage(model, output, parsed, mirror.prompt);
			const responseText = parsed.text;
			if (parsed.thinking) {
				const thinkingIndex = output.content.length;
				output.content.push({ type: "thinking", thinking: parsed.thinking });
				stream.push({ type: "thinking_start", contentIndex: thinkingIndex, partial: output });
				stream.push({ type: "thinking_delta", contentIndex: thinkingIndex, delta: parsed.thinking, partial: output });
				stream.push({ type: "thinking_end", contentIndex: thinkingIndex, content: parsed.thinking, partial: output });
			}
			const toolCalls = parseToolCalls(responseText);
			if (toolCalls.length > 0) {
				output.stopReason = "toolUse";
				for (const call of toolCalls) {
					const toolCall: ToolCall = {
						type: "toolCall",
						id: `claude_code_pi_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
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

			const contentIndex = output.content.length;
			output.content.push({ type: "text", text: responseText });
			stream.push({ type: "text_start", contentIndex, partial: output });
			if (responseText) {
				stream.push({ type: "text_delta", contentIndex, delta: responseText, partial: output });
			}
			stream.push({ type: "text_end", contentIndex, content: responseText, partial: output });
			stream.push({ type: "done", reason: "stop", message: output });
			stream.end();
		} catch (error) {
			if (timer && !settled) clearTimeout(timer);
			// Any interrupted persistent turn (abort, timeout, failure) leaves
			// Claude-side state unknown: rotate the UUID so the next turn seeds
			// fresh instead of resuming a half-written session.
			if (mirror?.record && mirror.mode !== "none" && getActivePiSessionId()) {
				await reseedRecord(mirror.record.piSessionId, process.cwd()).catch(() => undefined);
			}
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = await describeStreamError(error);
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
}
