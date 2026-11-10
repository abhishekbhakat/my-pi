import { randomUUID } from "node:crypto";
import { CURRENT_SESSION_VERSION, type ExtensionContext, type SessionEntry } from "@earendil-works/pi-coding-agent";

/** Capture the active branch now, not after the background task starts. */
export function snapshotContext(ctx: ExtensionContext): ExtensionContext {
	const branch = structuredClone(ctx.sessionManager.getBranch());
	const entries = structuredClone(ctx.sessionManager.getEntries());
	const sessionId = ctx.sessionManager.getSessionId();
	const prompt = ctx.getSystemPrompt();
	const manager = new Proxy(ctx.sessionManager, {
		get(target, key) {
			if (key === "getBranch") return () => structuredClone(branch);
			if (key === "getEntries") return () => structuredClone(entries);
			if (key === "getSessionId") return () => sessionId;
			const value = Reflect.get(target, key);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
	return { ...ctx, cwd: ctx.cwd, sessionManager: manager, getSystemPrompt: () => prompt };
}

/** Preserve all branch entries, including images, compaction and context edits. */
export function coderSession(branch: readonly SessionEntry[], cwd: string): string {
	const timestamp = new Date().toISOString();
	const rows: unknown[] = [{ type: "session", version: CURRENT_SESSION_VERSION, id: randomUUID(), timestamp, cwd }];
	let parentId: string | null = null;
	const pending = new Map<string, string>();
	for (const entry of branch) {
		rows.push({ ...entry, parentId });
		parentId = entry.id;
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message.role === "assistant") {
			for (const part of message.content) if (part.type === "toolCall") pending.set(part.id, part.name);
		} else if (message.role === "toolResult") pending.delete(message.toolCallId);
	}
	// Parent invocation and sibling calls have no results yet. Close them without
	// dropping the assistant's text, thinking, or any earlier branch context.
	for (const [toolCallId, toolName] of pending) {
		const id = randomUUID();
		rows.push({ type: "message", id, parentId, timestamp, message: {
			role: "toolResult", toolCallId, toolName, isError: false, timestamp: Date.now(),
			content: [{ type: "text", text: "Branch snapshot boundary: this parent tool call is pending. No result is available in this child branch." }],
		} });
		parentId = id;
	}
	return rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
}
