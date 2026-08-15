import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { classifyGemini } from "./gemini";
import { classifyOpenRouter } from "./openrouter";
import { parseDecision } from "./parse";
import { PROBE_PROMPT, type IntentRouterConfig } from "./types";

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	if (ms <= 0) return Promise.resolve();
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => resolve(), ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(signal?.reason ?? new Error("aborted"));
		};
		if (!signal) return;
		if (signal.aborted) {
			onAbort();
			return;
		}
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

export async function classify(
	ctx: ExtensionContext,
	config: IntentRouterConfig,
	prompt: string,
	lastAssistant?: string,
	signal?: AbortSignal,
) {
	const clipped = prompt.length > 4000 ? `${prompt.slice(0, 4000)}\n...[truncated]` : prompt;
	const attempts = 1 + (config.classifier.retries ?? 1);
	const delayMs = config.classifier.retryDelayMs ?? 250;
	let lastError: unknown;
	for (let attempt = 1; attempt <= attempts; attempt++) {
		try {
			const raw =
				config.classifier.backend === "gemini"
					? await classifyGemini(ctx, config.classifier, clipped, lastAssistant, signal)
					: await classifyOpenRouter(ctx, config.classifier, clipped, lastAssistant, signal);
			return parseDecision(raw);
		} catch (error) {
			lastError = error;
			if (signal?.aborted || attempt >= attempts) break;
			await sleep(delayMs, signal);
		}
	}
	throw lastError;
}

export async function probeClassifier(
	ctx: ExtensionContext,
	config: IntentRouterConfig,
): Promise<{ ok: true } | { ok: false; error: string }> {
	try {
		await classify(ctx, config, PROBE_PROMPT, undefined, AbortSignal.timeout(15000));
		return { ok: true };
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}
