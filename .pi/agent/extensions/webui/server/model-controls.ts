import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai/compat";
import type { IncomingMessage, ServerResponse } from "node:http";
import { json, readJson } from "../utils/http";

const changing = new WeakSet<object>();

function selectableModels(ctx: ExtensionContext) {
	const available = ctx.modelRegistry.getAvailable();
	if (!ctx.scopedModels?.length) return available;
	const byIdentity = new Map(available.map((model) => [JSON.stringify([model.provider, model.id]), model]));
	return ctx.scopedModels.flatMap(({ model }) => {
		const enabled = byIdentity.get(JSON.stringify([model.provider, model.id]));
		return enabled ? [enabled] : [];
	});
}

export function modelSettings(pi: ExtensionAPI, ctx: ExtensionContext) {
	const models = selectableModels(ctx);
	return {
		models: models.map((model) => ({
			provider: model.provider, id: model.id, name: model.name,
			thinkingLevels: getSupportedThinkingLevels(model),
		})),
		model: ctx.model ? { provider: ctx.model.provider, id: ctx.model.id } : null,
		thinkingLevel: pi.getThinkingLevel(),
	};
}

export async function handleModelSettings(
	pi: ExtensionAPI, ctx: ExtensionContext,
	request: IncomingMessage, response: ServerResponse,
	isCurrent: () => boolean,
): Promise<void> {
	if (request.method === "GET") {
		json(response, 200, modelSettings(pi, ctx));
		return;
	}
	if (request.method !== "POST") {
		json(response, 405, { error: "method not allowed" });
		return;
	}
	const body = await readJson<{ provider?: string; modelId?: string; thinkingLevel?: string }>(request);
	if (!isCurrent()) {
		json(response, 409, { error: "session changed; reopen from /ssm" });
		return;
	}
	if (!ctx.isIdle() || changing.has(pi)) {
		json(response, 409, { error: "wait for current run or model change to finish" });
		return;
	}
	const model = body.modelId === undefined ? ctx.model : selectableModels(ctx)
		.find((candidate) => candidate.provider === body.provider && candidate.id === body.modelId);
	if (!model) {
		json(response, 400, { error: "model unavailable" });
		return;
	}
	const levels = getSupportedThinkingLevels(model);
	if (body.thinkingLevel !== undefined && !levels.includes(body.thinkingLevel as typeof levels[number])) {
		json(response, 400, { error: "thinking effort unsupported by selected model" });
		return;
	}
	changing.add(pi);
	try {
		if (body.modelId !== undefined && !await pi.setModel(model)) {
			json(response, 400, { error: "model authentication unavailable" });
			return;
		}
		if (!isCurrent()) {
			json(response, 409, { error: "session changed during model update" });
			return;
		}
		if (body.thinkingLevel !== undefined) pi.setThinkingLevel(body.thinkingLevel as typeof levels[number]);
		json(response, 200, modelSettings(pi, ctx));
	} finally {
		changing.delete(pi);
	}
}
