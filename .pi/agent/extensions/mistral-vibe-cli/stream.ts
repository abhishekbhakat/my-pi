import { spawn } from "node:child_process";
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
import { buildVibeArgs, describeStreamError, requestTimeoutMs, STDERR_LIMIT, vibeBin, vibeEnv } from "./cli.ts";
import { bridgeContext, buildEmptyTurnPrompt, buildPrompt, buildRetryPrompt, firstInvalidToolCall, parseJsonOutput, parseToolCalls, repairToolArguments, safeJson, type BridgeContext } from "./prompt.ts";

// Capability calls are marked by capability-tools metadata. They decide their
// own context and must never see tool-call syntax: their answers would be
// wiped into stopReason toolUse otherwise.
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

// `vibe -p --output json` carries no token accounting; estimate like the
// claude-code-pi fallback so Pi's usage display stays populated.
function applyUsage(model: Model<Api>, output: AssistantMessage, prompt: string, responseText: string) {
	output.usage.input = Math.max(1, Math.ceil(prompt.length / 4));
	output.usage.output = Math.max(1, Math.ceil((responseText || " ").length / 4));
	output.usage.totalTokens = output.usage.input + output.usage.output;
	calculateCost(model, output.usage);
}

type VibeRunResult = { stdout: string; stderr: string };

// One `vibe -p` run: spawn, feed the prompt on stdin, enforce timeout and
// abort, and surface nonzero exits as errors.
async function runVibeOnce(model: Model<Api>, prompt: string, options?: SimpleStreamOptions): Promise<VibeRunResult> {
	let stdout = "";
	let stderr = "";
	let timedOut = false;

	const child = spawn(vibeBin(), buildVibeArgs(), {
		stdio: ["pipe", "pipe", "pipe"],
		env: vibeEnv(model.id),
		cwd: process.cwd(),
	});

	const abort = () => child.kill("SIGTERM");
	const timeout = requestTimeoutMs();
	const timer = setTimeout(() => {
		timedOut = true;
		child.kill("SIGTERM");
	}, timeout);
	options?.signal?.addEventListener("abort", abort, { once: true });

	// Vibe can exit before consuming a large stdin; EPIPE must not crash Pi.
	child.stdin!.on("error", () => undefined);
	child.stdin!.end(prompt);
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
	clearTimeout(timer);
	options?.signal?.removeEventListener("abort", abort);

	if (options?.signal?.aborted) throw new Error("Request was aborted");
	if (timedOut) throw new Error(`vibe -p timed out after ${timeout}ms`);
	if (code !== 0) {
		throw new Error(stderr.trim() || stdout.trim().slice(-2_000) || `vibe -p exited with code ${code}`);
	}
	return { stdout, stderr };
}

export function streamVibeCli(
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

		let bridge: BridgeContext | undefined;
		let prompt = "";

		try {
			bridge = bridgeContext(context);
			prompt = buildPrompt(bridge);
			stream.push({ type: "start", partial: output });

			const first = await runVibeOnce(model, prompt, options);
			let parsed = parseJsonOutput(first.stdout);
			if (parsed.isError) throw new Error(parsed.text || first.stderr.trim() || "vibe -p returned an error result");

			// Capability helpers and other tool-free callers get plain text only.
			const allowTools = !isCapabilityCall(options) && bridge.tools.length > 0;
			let toolCalls = allowTools ? repairToolArguments(bridge.tools, parseToolCalls(parsed.text)) : [];

			// Hand-written JSON sometimes breaks (triple quotes, raw newlines in
			// string values). When blocks exist but none parse, ask Vibe once to
			// re-emit them instead of letting the block land as plain text.
			const invalidReason = allowTools ? firstInvalidToolCall(parsed.text) : undefined;
			if (invalidReason !== undefined) {
				const retryPrompt = buildRetryPrompt(prompt, parsed.text, invalidReason);
				const retry = await runVibeOnce(model, retryPrompt, options);
				const retryParsed = parseJsonOutput(retry.stdout);
				if (!retryParsed.isError) {
					const retryCalls = allowTools ? repairToolArguments(bridge.tools, parseToolCalls(retryParsed.text)) : [];
					if (retryCalls.length > 0) {
						parsed = retryParsed;
						toolCalls = retryCalls;
						prompt = retryPrompt;
					}
				}
			}

			// A thinking-only turn (no text, no tool calls) would end Pi's turn
			// silently. Ask Vibe once for the missing message; a still-empty result
			// surfaces as an error instead of a blank assistant message.
			if (toolCalls.length === 0 && !parsed.text.trim()) {
				const emptyPrompt = buildEmptyTurnPrompt(prompt, parsed.thinking);
				const retry = await runVibeOnce(model, emptyPrompt, options);
				const retryParsed = parseJsonOutput(retry.stdout);
				if (!retryParsed.isError) {
					const retryCalls = allowTools ? repairToolArguments(bridge.tools, parseToolCalls(retryParsed.text)) : [];
					if (retryCalls.length > 0 || retryParsed.text.trim()) {
						parsed = retryParsed;
						toolCalls = retryCalls;
						prompt = emptyPrompt;
					}
				}
			}
			if (toolCalls.length === 0 && !parsed.text.trim()) {
				throw new Error("vibe -p returned a thinking-only message with no text or tool calls");
			}

			applyUsage(model, output, prompt, parsed.text);
			if (parsed.thinking) {
				const thinkingIndex = output.content.length;
				output.content.push({ type: "thinking", thinking: parsed.thinking });
				stream.push({ type: "thinking_start", contentIndex: thinkingIndex, partial: output });
				stream.push({ type: "thinking_delta", contentIndex: thinkingIndex, delta: parsed.thinking, partial: output });
				stream.push({ type: "thinking_end", contentIndex: thinkingIndex, content: parsed.thinking, partial: output });
			}
			if (toolCalls.length > 0) {
				output.stopReason = "toolUse";
				for (const call of toolCalls) {
					const toolCall: ToolCall = {
						type: "toolCall",
						id: `mistral_vibe_cli_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
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
			output.content.push({ type: "text", text: parsed.text });
			stream.push({ type: "text_start", contentIndex, partial: output });
			if (parsed.text) {
				stream.push({ type: "text_delta", contentIndex, delta: parsed.text, partial: output });
			}
			stream.push({ type: "text_end", contentIndex, content: parsed.text, partial: output });
			stream.push({ type: "done", reason: "stop", message: output });
			stream.end();
		} catch (error) {
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = await describeStreamError(error);
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
}
