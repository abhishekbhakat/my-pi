import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

const CONFIRM = /^(y|yes|yeah|yep|ok|okay|sure|go|go ahead|do it|do that|proceed|continue|lgtm|ship it)[.!\s]*$/i;

export function isConfirmation(prompt: string): boolean {
	return CONFIRM.test(prompt.trim());
}

function messageText(content: unknown): string {
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: "text"; text: string } =>
			typeof part === "object" &&
			part !== null &&
			"type" in part &&
			part.type === "text" &&
			"text" in part &&
			typeof part.text === "string",
		)
		.map((part) => part.text)
		.join("\n")
		.trim();
}

export function lastAssistantText(ctx: ExtensionContext, maxChars = 1500): string | undefined {
	const branch = ctx.sessionManager.getBranch();
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry.type !== "message") continue;
		const message = entry.message as { role?: string; content?: unknown };
		if (message.role !== "assistant") continue;
		const text = messageText(message.content);
		if (!text) continue;
		return text.length > maxChars ? `${text.slice(0, maxChars)}\n...[truncated]` : text;
	}
	return undefined;
}
