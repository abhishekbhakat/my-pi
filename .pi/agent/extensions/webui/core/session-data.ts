import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { WebUiRuntime } from "../runtime/types";

function serializeTools(pi: ExtensionAPI) {
	return pi.getAllTools().map((tool) => ({
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters,
	}));
}

export interface EntryCursor {
	sessionId: string | null;
	count: number;
	lastId: string | null;
}

/** A cursor is valid only against the same append-only session prefix. */
export function buildEntryDelta(
	manager: { getSessionId(): string; getEntries(): unknown[]; getLeafId(): string | null },
	cursor: EntryCursor,
) {
	const entries = manager.getEntries() as { id: string }[];
	const count = entries.length;
	const sessionId = manager.getSessionId();
	const valid = cursor.sessionId === sessionId && Number.isSafeInteger(cursor.count) &&
		cursor.count >= 0 && cursor.count <= count &&
		(cursor.count === 0 ? !cursor.lastId : entries[cursor.count - 1]?.id === cursor.lastId);
	return {
		reset: !valid,
		sessionId,
		count,
		lastId: entries.at(-1)?.id ?? null,
		leafId: manager.getLeafId(),
		entries: valid ? entries.slice(cursor.count) : entries,
	};
}

export function buildSessionData(pi: ExtensionAPI, ctx: ExtensionContext, runtime: WebUiRuntime) {
	return {
		header: ctx.sessionManager.getHeader(),
		entries: ctx.sessionManager.getEntries(),
		leafId: ctx.sessionManager.getLeafId(),
		systemPrompt: runtime.currentSystemPrompt,
		tools: serializeTools(pi),
		renderedTools: undefined,
	};
}
