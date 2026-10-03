/**
 * One Jev-compatible HTTP call. Covers TypeSafe/OpenCode Zen SystemOne,
 * Perplexity Decisions, Fastino GLiDE (same wire format), and Cloudflare
 * Clef (same format, response wrapped in { result, success }).
 */
import type {
	DeciderAnswer,
	DeciderError,
	DeciderModelConfig,
	DeciderOk,
	DeciderProviderConfig,
	WireQuestions,
} from "./types.ts";
import { accountIdFor } from "./config.ts";

const DEFAULT_TIMEOUT_MS = 10_000;

export type CallOptions = {
	signal?: AbortSignal;
	/** 0 disables the timer; undefined falls back to the model config. */
	timeoutMs?: number;
	fetcher?: typeof fetch;
};

export async function callDecider(
	provider: DeciderProviderConfig,
	model: DeciderModelConfig,
	apiKey: string,
	state: Record<string, unknown>,
	questions: WireQuestions,
	options: CallOptions = {},
): Promise<DeciderOk | DeciderError> {
	const parent = options.signal;
	const timeoutMs = options.timeoutMs ?? model.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const controller = new AbortController();
	const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
	const onParentAbort = () => controller.abort();
	parent?.addEventListener("abort", onParentAbort, { once: true });

	let url = provider.baseUrl;
	if (provider.adapter === "clef") {
		const accountId = accountIdFor(provider);
		if (!accountId) {
			return {
				ok: false,
				code: "no-key",
				message:
					"cloudflare accountId missing. Set deciders.json providers.cloudflare.accountId or CLOUDFLARE_ACCOUNT_ID.",
				model: model.id,
			};
		}
		url = `${url.replace("{accountId}", accountId)}/${model.urlModel ?? model.model}`;
	}
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (provider.authHeader === "x-api-key") headers["X-API-Key"] = apiKey;
	else headers.Authorization = `Bearer ${apiKey}`;

	try {
		const response = await (options.fetcher ?? fetch)(url, {
			method: "POST",
			headers,
			body: JSON.stringify({ state, model: model.model, questions }),
			signal: controller.signal,
		});
		if (response.status === 401) {
			return { ok: false, code: "unauthorized", message: `${model.id} rejected the API key (401).`, model: model.id };
		}
		const rawText = await response.text();
		let body: Record<string, unknown>;
		try {
			body = JSON.parse(rawText) as Record<string, unknown>;
		} catch {
			return { ok: false, code: "http", message: `${model.id} returned non-JSON (HTTP ${response.status}).`, model: model.id };
		}
		if (response.status === 422) {
			return { ok: false, code: "unprocessable", message: JSON.stringify(body.detail ?? "unprocessable"), model: model.id };
		}
		if (!response.ok) {
			const detail = body.detail;
			const detailType =
				typeof detail === "string" ? detail : detail && typeof detail === "object" ? String((detail as { error_type?: string }).error_type ?? "") : "";
			if (detailType === "max_tokens_exceeded") {
				return { ok: false, code: "state-too-large", message: `${model.id} max_tokens_exceeded. Shrink the state.`, model: model.id };
			}
			return {
				ok: false,
				code: "http",
				message: `${model.id} HTTP ${response.status}${detailType ? ` ${detailType}` : ""}.`,
				model: model.id,
			};
		}
		const result = provider.adapter === "clef" ? (body.result as Record<string, unknown> | undefined) : body;
		if (provider.adapter === "clef" && (body.success === false || !result)) {
			return { ok: false, code: "http", message: "cloudflare returned success=false.", model: model.id };
		}
		const answers = (result?.answers ?? {}) as Record<string, DeciderAnswer>;
		if (!answers || typeof answers !== "object") {
			return { ok: false, code: "invalid", message: `${model.id} returned no answers object.`, model: model.id };
		}
		return {
			ok: true,
			model: typeof result?.model === "string" ? result.model : model.id,
			answers,
			usage: result?.usage,
		};
	} catch (error) {
		if (parent?.aborted) return { ok: false, code: "aborted", message: "Request aborted.", model: model.id };
		if (error instanceof Error && error.name === "AbortError") {
			return { ok: false, code: "timeout", message: `${model.id} timed out after ${timeoutMs}ms.`, model: model.id };
		}
		return { ok: false, code: "http", message: `${model.id} request failed.`, model: model.id };
	} finally {
		if (timer) clearTimeout(timer);
		parent?.removeEventListener("abort", onParentAbort);
	}
}
