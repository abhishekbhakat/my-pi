import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: "text"; text: string } =>
			!!part && typeof part === "object" && (part as { type?: unknown }).type === "text" && typeof (part as { text?: unknown }).text === "string",
		)
		.map((part) => part.text)
		.join("\n");
}

/** Latest human user message on the active session branch. */
export function getLatestUserMessage(ctx: ExtensionContext): string {
	const branch = ctx.sessionManager.getBranch();
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry.type !== "message") continue;
		const msg = entry.message as { role?: string; content?: unknown };
		if (msg.role !== "user") continue;
		const text = extractText(msg.content).trim();
		if (text) return text;
	}
	return "";
}
