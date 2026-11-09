import { readFile } from "node:fs/promises";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

interface Limits {
	contextWindow?: number;
	maxTokens?: number;
}

function positive(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Catalog capacity is independent of models.json chat context overrides. */
export function inputBudget(
	model: Limits,
	baseline: Limits | undefined,
	reservedText: string,
): { contextWindow: number; inputTokens: number; maxContextChars: number } {
	const contextWindow = positive(baseline?.contextWindow) ? Math.floor(baseline.contextWindow) : model.contextWindow;
	if (!positive(contextWindow)) throw new Error("Capability model has no valid context window");
	// Preserve the configured output allowance rather than requesting the provider maximum.
	const output = positive(model.maxTokens) ? Math.ceil(model.maxTokens) : 0;
	// UTF-8 bytes are a conservative token estimate, not an exact tokenizer.
	// Reserve tool results and framing, plus 10% for tokenizer/protocol differences.
	const reserve = Buffer.byteLength(reservedText, "utf8") + Math.min(65536, Math.floor(contextWindow * 0.1));
	const inputTokens = Math.floor(contextWindow * 0.9) - output - reserve;
	if (inputTokens < 12000) throw new Error("Capability model context is too small for reserved output and tool context");
	// Three bytes per UTF-16 code unit bounds UTF-8 size, including non-ASCII input.
	return { contextWindow, inputTokens, maxContextChars: Math.floor(inputTokens / 3) };
}

async function readJson(url: URL): Promise<any> {
	try {
		return JSON.parse(await readFile(url, "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw new Error(`Cannot read capability model limits from ${url.pathname}`, { cause: error });
	}
}

export async function capabilityBudget(ctx: ExtensionContext, model: Model<Api>, reservedText: string) {
	const store = await readJson(new URL("../../models-store.json", import.meta.url));
	const catalog = store[model.provider]?.models?.find((item: { id: string }) => item.id === model.id);
	const registered = ctx.modelRegistry.getRegisteredProviderConfig(model.provider)?.models
		?.find((item) => item.id === model.id);
	// models.json supplies custom models absent from the catalog. Its modelOverrides
	// are intentionally ignored here; those remain chat-only context limits.
	const configured = await readJson(new URL("../../models.json", import.meta.url));
	const custom = configured.providers?.[model.provider]?.models?.find((item: { id: string }) => item.id === model.id);
	const candidates = [catalog, registered, custom];
	const baseline = candidates.find((item) => positive(item?.contextWindow));
	const source = baseline === catalog && baseline ? "catalog"
		: baseline === registered && baseline ? "provider"
		: baseline ? "custom-model" : "registry";
	return { ...inputBudget(model, baseline, reservedText), source };
}
