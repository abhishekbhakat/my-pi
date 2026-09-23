import {
	collapseSystemMessages,
	getCurrentSystemPrompt,
	getCurrentTools,
	withoutInitialSystemMessage,
	type AssistantMessage,
	type Context,
	type ImageContent,
	type Message,
	type TextContent,
	type Tool,
	type ToolCall,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import { hashText } from "./sessions.ts";

const BRIDGE_BASE = `# Pi/Claude Code CLI bridge instructions

You are being used as the model backend for Pi Coding Agent through the local Claude Code CLI.
The extension invokes Claude Code with \`claude -p\` for each model turn.
Claude Code's own tools are disabled with \`--tools ""\`; Pi, not Claude Code, executes real file, shell, network, and MCP actions.`;

const BRIDGE_TOOLS = `If you need Pi to run a tool, output only one or more tool-call blocks and no prose:
<pi_tool_call>{"name":"tool_name","arguments":{}}</pi_tool_call>

Rules for Pi tool calls:
- Use only tools listed in the "Available Pi tools" section.
- The JSON inside <pi_tool_call> must be valid JSON with "name" and "arguments" fields.
- Do not wrap tool calls in Markdown fences.
- If you can answer without a tool, answer normally in plain text.
- After Pi returns tool results, continue from the transcript and either answer or request another Pi tool call.`;

const BRIDGE_NO_TOOLS = `No tools are available for this turn.
Do not emit <pi_tool_call> blocks, XML tool tags, or any function-call syntax.
Answer in plain text only.`;

function bridgeInstructions(tools: Tool[]): string {
	return tools.length > 0 ? `${BRIDGE_BASE}\n\n${BRIDGE_TOOLS}` : `${BRIDGE_BASE}\n\n${BRIDGE_NO_TOOLS}`;
}

export function safeJson(value: unknown): string {
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function contentToText(content: string | (TextContent | ImageContent)[]): string {
	if (typeof content === "string") return content;
	return content
		.map((item) => {
			if (item.type === "text") return item.text;
			return `[image omitted: ${item.mimeType}, ${item.data.length} base64 chars]`;
		})
		.join("\n");
}

export function serializeMessage(message: Message): string {
	if (message.role === "user") {
		return `USER:\n${contentToText(message.content)}`;
	}

	if (message.role === "toolResult") {
		return [
			`PI TOOL RESULT (${message.toolName}, id=${message.toolCallId}, isError=${message.isError}):`,
			contentToText(message.content),
		].join("\n");
	}

	const parts = typeof message.content === "string"
		? [message.content]
		: message.content.map((part: TextContent | ToolCall | { type: "thinking"; thinking: string }) => {
				if (part.type === "text") return part.text;
				if (part.type === "thinking") return `<thinking>${part.thinking}</thinking>`;
				return `<pi_tool_call>${safeJson({ name: part.name, arguments: part.arguments })}</pi_tool_call>`;
			});
	return `ASSISTANT:\n${parts.join("\n")}`;
}

export function serializeTools(tools?: Tool[]): string {
	if (!tools || tools.length === 0) return "";
	return safeJson(
		tools.map((tool) => ({
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
		})),
	);
}

export function contextImages(context: Context): ImageContent[] {
	return context.messages.flatMap((message) =>
		message.role === "user" && Array.isArray(message.content)
			? message.content.filter((item): item is ImageContent => item.type === "image")
			: [],
	);
}

export type BridgeContext = {
	systemPrompt: string;
	messages: Message[];
	tools: Tool[];
};

/**
 * Provider streamSimple receives a normalized transcript, not Context shorthand.
 * Replays system messages into the bridge prompt shape Pi used before
 * normalization: one system prompt, current tools, and conversation messages.
 */
export function bridgeContext(context: TranscriptContext): BridgeContext {
	const normalized = collapseSystemMessages(context);
	return {
		systemPrompt: getCurrentSystemPrompt(normalized.messages),
		messages: withoutInitialSystemMessage(normalized.messages),
		tools: getCurrentTools(normalized.messages),
	};
}

export function buildPrompt(context: BridgeContext): string {
	const sections: string[] = [bridgeInstructions(context.tools)];
	if (context.systemPrompt?.trim()) {
		sections.push(`# Pi system prompt\n\n${context.systemPrompt}`);
	}
	sections.push(...(context.tools.length > 0 ? [`# Available Pi tools\n\n${serializeTools(context.tools)}`] : []));
	if (context.messages.length > 0) {
		sections.push(`# Conversation transcript\n\n${context.messages.map(serializeMessage).join("\n\n---\n\n")}`);
	} else {
		sections.push("# Conversation transcript\n\n(no prior messages)");
	}
	sections.push(
		context.tools.length > 0
			? "Now produce the next assistant message for Pi."
			: "Now produce the next assistant message for Pi as plain text only. No tool calls.",
	);
	return sections.join("\n\n---\n\n");
}

function assistantText(message: Message): string {
	const parts = (message as AssistantMessage).content ?? [];
	return parts
		.map((part: any) => {
			if (part.type === "text") return part.text;
			if (part.type === "thinking") return part.thinking;
			return "";
		})
		.filter(Boolean)
		.join("\n");
}

// Skip a leading assistant message only when it is the exact reply the mirror
// recorded last turn. Anything else (other provider, unknown provenance) is
// sent so Claude never loses context.
function skipRecordedReply(messages: Message[], lastReplyHash: string | undefined): Message[] {
	if (!lastReplyHash || messages.length === 0) return messages;
	const first = messages[0];
	if (first.role !== "assistant") return messages;
	return hashText(assistantText(first)) === lastReplyHash ? messages.slice(1) : messages;
}

// Messages that will actually be written to Claude Code for a resume turn.
export function selectSentMessages(context: BridgeContext, syncedCount: number, lastReplyHash?: string): Message[] {
	return skipRecordedReply(context.messages.slice(syncedCount), lastReplyHash);
}

export function buildDeltaPrompt(
	context: BridgeContext,
	syncedCount: number,
	lastReplyHash?: string,
): string {
	const delta = skipRecordedReply(context.messages.slice(syncedCount), lastReplyHash);
	const body =
		delta.length === 0
			? "(no new Pi messages; continue from the Claude Code session.)"
			: delta.map(serializeMessage).join("\n\n---\n\n");
	const sections = [
		bridgeInstructions(context.tools),
		...(context.tools.length > 0 ? [`# Available Pi tools\n\n${serializeTools(context.tools)}`] : []),
		"# New messages since last Claude Code turn",
		body,
		context.tools.length > 0
			? "Produce the next assistant message for Pi. Prior turns already live in this Claude Code session."
			: "Produce the next assistant message for Pi as plain text only. No tool calls. Prior turns already live in this Claude Code session.",
	];
	return sections.join("\n\n---\n\n");
}

export function buildStreamJsonInput(images: ImageContent[], prompt: string): string {
	const content: Array<Record<string, unknown>> = images.map((image) => ({
		type: "image",
		source: { type: "base64", media_type: image.mimeType, data: image.data },
	}));
	content.push({ type: "text", text: prompt });
	return `${JSON.stringify({ type: "user", message: { role: "user", content } })}\n`;
}

export type ParsedCliUsage = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
};

export function parseStreamJsonOutput(stdout: string): {
	text: string;
	thinking: string;
	sessionId?: string;
	usage?: ParsedCliUsage;
	isError?: boolean;
} {
	const texts: string[] = [];
	const thoughts: string[] = [];
	let result = "";
	let sessionId: string | undefined;
	let usage: ParsedCliUsage | undefined;
	let isError = false;
	for (const line of stdout.split("\n")) {
		if (!line.trim()) continue;
		let event: any;
		try {
			event = JSON.parse(line);
		} catch {
			continue;
		}
		if (event?.type === "assistant") {
			for (const block of event.message?.content ?? []) {
				if (block?.type === "text" && typeof block.text === "string" && block.text) texts.push(block.text);
				if (block?.type === "thinking" && typeof block.thinking === "string" && block.thinking) {
					thoughts.push(block.thinking);
				}
			}
		} else if (event?.type === "result") {
			if (typeof event.result === "string") result = event.result;
			if (typeof event.session_id === "string") sessionId = event.session_id;
			if (event.is_error === true || event.subtype === "error") isError = true;
			const u = event.usage;
			if (u && typeof u === "object") {
				usage = {
					input: Number(u.input_tokens) || 0,
					output: Number(u.output_tokens) || 0,
					cacheRead: Number(u.cache_read_input_tokens) || 0,
					cacheWrite: Number(u.cache_creation_input_tokens) || 0,
				};
			}
		}
	}
	return { text: result || texts.join("\n"), thinking: thoughts.join("\n\n"), sessionId, usage, isError };
}

function parseToolCallJson(raw: string): Array<{ name: string; arguments: Record<string, any> }> {
	let value: any;
	try {
		value = JSON.parse(raw.trim());
	} catch {
		return [];
	}

	const candidates = Array.isArray(value)
		? value
		: Array.isArray(value?.tool_calls)
			? value.tool_calls
			: [value];
	const calls: Array<{ name: string; arguments: Record<string, any> }> = [];
	for (const candidate of candidates) {
		const name =
			typeof candidate?.name === "string"
				? candidate.name
				: typeof candidate?.tool === "string"
					? candidate.tool
					: undefined;
		const args = candidate?.arguments ?? candidate?.args ?? candidate?.input ?? {};
		if (!name || typeof args !== "object" || args === null || Array.isArray(args)) continue;
		calls.push({ name, arguments: args });
	}
	return calls;
}

export function parseToolCalls(text: string): Array<{ name: string; arguments: Record<string, any> }> {
	const tagRegex = /<pi_tool_call>([\s\S]*?)<\/pi_tool_call>/g;
	const matches = [...text.trim().matchAll(tagRegex)];
	return matches.flatMap((match) => parseToolCallJson(match[1] ?? ""));
}
