/**
 * Role-based entry point for Jev-compatible decision models.
 * askDeciders walks the role's model chain from deciders.json and returns
 * the first success. Errors carry a code; callers decide fail-open or loud.
 */
import { callDecider } from "./call.ts";
import { loadRegistry, modelsForRole, providerFor, resolveKey } from "./config.ts";
import type { DeciderResult, WireQuestions } from "./types.ts";

export type AskOptions = {
	signal?: AbortSignal;
	/** 0 disables the timer; undefined uses the model config default. */
	timeoutMs?: number;
	fetcher?: typeof fetch;
};

/** First model id configured for a role, for status text and descriptions. */
export function deciderModelLabel(role: string): string {
	const models = modelsForRole(loadRegistry(), role);
	return models[0]?.id ?? `${role} (unconfigured)`;
}

export async function askDeciders(
	role: string,
	state: Record<string, unknown>,
	questions: WireQuestions,
	options: AskOptions = {},
): Promise<DeciderResult> {
	const registry = loadRegistry();
	const chain = modelsForRole(registry, role);
	if (chain.length === 0) {
		return { ok: false, code: "no-model", message: `deciders.json has no model for role ${role}.` };
	}
	const entries = Object.entries(questions);
	const kinds = new Set(entries.map(([, question]) => question.type));

	let last: DeciderResult = { ok: false, code: "no-model", message: `role ${role} has no usable model.` };
	for (const model of chain) {
		const provider = providerFor(registry, model);
		if (!provider) {
			last = { ok: false, code: "no-model", message: `deciders.json has no provider ${model.provider}.`, model: model.id };
			continue;
		}
		const supported = model.kinds ?? ["noul", "choice", "score"];
		const fits = entries.length === 0 || ([...kinds].every((kind) => supported.includes(kind)) && entries.length <= (model.maxQuestions ?? 16));
		if (!fits) {
			last = { ok: false, code: "unsupported", message: `${model.id} does not support this question set.`, model: model.id };
			continue;
		}
		const apiKey = resolveKey(provider.authProvider);
		if (!apiKey) {
			last = {
				ok: false,
				code: "no-key",
				message: `No API key for ${provider.authProvider}. Add it to auth.json or set the env var.`,
				model: model.id,
			};
			continue;
		}
		const result = await callDecider(provider, model, apiKey, state, questions, options);
		if (result.ok) return result;
		if (result.code === "aborted") return result;
		last = result;
	}
	return last;
}

export { loadRegistry, modelsForRole, resolveKey } from "./config.ts";
export type { DeciderRegistry, DeciderModelConfig, DeciderProviderConfig, WireQuestions, DeciderResult } from "./types.ts";
