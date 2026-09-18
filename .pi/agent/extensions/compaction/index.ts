/**
 * Local compaction summary. Prompts, serialize, split-turn merge, file tags
 * live in this folder. Core still chooses the cut (prepareCompaction).
 *
 * Returning a result sets fromHook. Next core compact skips inheriting file
 * lists from this entry.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { compactLocal } from "./compact.ts";

export default function (pi: ExtensionAPI) {
	pi.on("session_before_compact", async (event, ctx) => {
		const model = ctx.model;
		if (!model) return;

		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
		if (!auth.ok) return;

		try {
			const result = await compactLocal(
				event.preparation,
				model,
				auth.apiKey,
				auth.headers,
				event.customInstructions,
				event.signal,
				ctx.thinkingLevel,
				undefined,
				auth.env,
				undefined,
				undefined,
				undefined,
				(message) => ctx.ui.setStatus(message),
			);
			return { compaction: result };
		} catch {
			ctx.ui.setStatus(undefined);
			return;
		}
	});
}
