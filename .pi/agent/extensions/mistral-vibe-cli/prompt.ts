import {
	collapseSystemMessages,
	getCurrentSystemPrompt,
	getCurrentTools,
	withoutInitialSystemMessage,
	type ImageContent,
	type Message,
	type TextContent,
	type Tool,
	type ToolCall,
	type TranscriptContext,
} from "@earendil-works/pi-ai";

const BRIDGE_BASE = `# Pi/Mistral Vibe CLI bridge instructions

You are being used as the model backend for Pi Coding Agent through the local Mistral Vibe CLI.
The extension invokes Vibe with \`vibe -p\` for each model turn.
Vibe's own tools are disabled; Pi, not Vibe, executes real file, shell, network, and MCP actions.`;

const BRIDGE_TOOLS = `If you need Pi to run a tool, output only one or more tool-call blocks and no prose:
<pi_tool_call>{"name":"tool_name","arguments":{}}</pi_tool_call>

Rules for Pi tool calls:
- Use only tools listed in the "Available Pi tools" section.
- The JSON inside <pi_tool_call> must be valid JSON with "name" and "arguments" fields.
- Arguments must use the exact property names from the tool's parameters schema, including every required property.
- Inside JSON string values, escape every newline as \\n and every double quote as \\"; never use triple quotes or raw multi-line strings.
- Close every block with <\/pi_tool_call> and output nothing after it.
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

// Vibe -p takes no images, so image blocks degrade to a placeholder line
// instead of crashing the turn when a transcript carries one.
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

export type ParsedVibeOutput = {
	text: string;
	thinking: string;
	isError: boolean;
};

type VibeEntry = {
	type?: string;
	role?: string;
	source?: string;
	generationStatus?: string;
	text?: string;
	content?: Array<{ type?: string; text?: string; thinking?: string }>;
};

function entryText(entry: VibeEntry): { text: string; thinking: string } {
	const texts: string[] = [];
	const thoughts: string[] = [];
	for (const block of entry.content ?? []) {
		if (block?.type === "text" && typeof block.text === "string" && block.text) texts.push(block.text);
		if (block?.type === "thinking" && typeof (block.thinking ?? block.text) === "string") {
			thoughts.push(block.thinking ?? block.text ?? "");
		}
	}
	return { text: texts.join("\n"), thinking: thoughts.join("\n\n") };
}

/**
 * `vibe -p --output json` prints one JSON array of session entries. Assistant
 * model output arrives as message entries with source "harness". Anything that
 * fails to parse is surfaced as an error result, never silently dropped.
 */
export function parseJsonOutput(stdout: string): ParsedVibeOutput {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stdout);
	} catch {
		// Not JSON: surface what Vibe actually printed so the error is diagnosable.
		return { text: stdout.trim().slice(0, 2_000), thinking: "", isError: true };
	}

	const entries: VibeEntry[] = Array.isArray(parsed) ? (parsed as VibeEntry[]) : [parsed as VibeEntry];
	const texts: string[] = [];
	const thoughts: string[] = [];
	let failed = entries.length === 0;
	for (const entry of entries) {
		if (entry?.type === "error" || entry?.generationStatus === "error") {
			failed = true;
			const { text } = entryText(entry);
			if (text) texts.push(text);
			continue;
		}
		if (entry?.type === "reasoning") {
			// Vibe emits thinking as a top-level entry: {type: "reasoning", text, summary}.
			if (typeof entry.text === "string" && entry.text) thoughts.push(entry.text);
			continue;
		}
		if (entry?.type !== "message" || entry?.role !== "assistant") continue;
		const { text, thinking } = entryText(entry);
		if (text) texts.push(text);
		if (thinking) thoughts.push(thinking);
	}
	if (texts.length === 0 && thoughts.length === 0) failed = true;
	return { text: texts.join("\n"), thinking: thoughts.join("\n\n"), isError: failed };
}

// Complete <pi_tool_call>...</pi_tool_call> blocks, plus a trailing
// unterminated block: the model sometimes ends its message right after the
// JSON and never emits the closing tag.
function toolCallBlocks(text: string): string[] {
	const blocks = [...text.matchAll(/<pi_tool_call>([\s\S]*?)<\/pi_tool_call>/g)].map((match) => match[1] ?? "");
	const lastOpen = text.lastIndexOf("<pi_tool_call>");
	if (lastOpen !== -1 && text.indexOf("</pi_tool_call>", lastOpen) === -1) {
		const rest = text.slice(lastOpen + "<pi_tool_call>".length);
		if (rest.trim().length > 0) blocks.push(rest);
	}
	return blocks;
}

// Lenient parse for hand-written blocks: strict JSON first, then salvage a
// complete JSON value followed by junk (stray backticks, prose) by cutting
// at the last closing brace.
function parseLeadingJson(raw: string): unknown | undefined {
	const text = raw.trim();
	try {
		return JSON.parse(text);
	} catch {
		// Fall through to the salvage attempt.
	}
	const lastBrace = text.lastIndexOf("}");
	if (lastBrace === -1) return undefined;
	try {
		return JSON.parse(text.slice(0, lastBrace + 1));
	} catch {
		return undefined;
	}
}

function parseToolCallJson(raw: string): Array<{ name: string; arguments: Record<string, any> }> {
	const parsed = parseLeadingJson(raw);
	if (parsed === undefined) return [];
	const value = parsed as any;

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
	return toolCallBlocks(text).flatMap((raw) => parseToolCallJson(raw));
}

// A <pi_tool_call> block that does not parse silently becomes plain text: Pi
// never sees a tool call. Detect that case so the bridge can ask the model to
// re-emit the block.
export function firstInvalidToolCall(text: string): string | undefined {
	for (const raw of toolCallBlocks(text)) {
		let value: unknown;
		try {
			value = JSON.parse(raw.trim());
		} catch (error) {
			const salvaged = parseLeadingJson(raw);
			if (salvaged === undefined) {
				return `invalid JSON: ${error instanceof Error ? error.message : String(error)}`;
			}
			value = salvaged;
		}
		const candidate = (Array.isArray(value) ? value[0] : value) as
			| { name?: unknown; tool?: unknown; arguments?: unknown; args?: unknown; input?: unknown }
			| undefined;
		const name = candidate?.name ?? candidate?.tool;
		if (typeof name !== "string" || name === "") return "missing tool name";
		const args = candidate?.arguments ?? candidate?.args ?? candidate?.input;
		if (typeof args !== "object" || args === null || Array.isArray(args)) return "missing arguments object";
	}
	return undefined;
}

const RETRY_INSTRUCTIONS = `Your previous message contains <pi_tool_call> block(s) that could not be used: <reason>.
Re-emit the tool call(s) as valid JSON. Inside JSON string values, escape every newline as \\n and every double quote as \\". Never use triple quotes or raw multi-line strings. Close every block with <\/pi_tool_call> and output nothing after it.
Output only the corrected <pi_tool_call> block(s), no prose.`;

export function buildRetryPrompt(basePrompt: string, previousText: string, reason: string): string {
	return [
		basePrompt,
		`ASSISTANT:\n${previousText}`,
		`USER:\n${RETRY_INSTRUCTIONS.replace("<reason>", reason)}`,
	].join("\n\n---\n\n");
}

const EMPTY_TURN_INSTRUCTIONS = `Your previous message ended after its thinking with no visible answer.
Produce the next assistant message now: answer the user in plain text, or emit <pi_tool_call> block(s) when a tool is needed. Do not repeat the thinking.`;

export function buildEmptyTurnPrompt(basePrompt: string, previousThinking: string): string {
	return [
		basePrompt,
		`ASSISTANT:\n<thinking>${previousThinking}</thinking>`,
		`USER:\n${EMPTY_TURN_INSTRUCTIONS}`,
	].join("\n\n---\n\n");
}

// The bridge has no native function calling: the model hand-writes argument
// JSON, so required properties sometimes arrive under near-miss names (for
// example "question" instead of "task"). Repair against the tool schema so
// Pi validation does not reject otherwise valid calls.
const ARGUMENT_ALIASES: Record<string, string[]> = {
	task: ["question", "query", "prompt", "request", "objective", "input"],
};

type ToolParameters = {
	properties?: Record<string, unknown>;
	required?: string[];
};

export function repairToolArguments(
	tools: Tool[],
	calls: Array<{ name: string; arguments: Record<string, any> }>,
): Array<{ name: string; arguments: Record<string, any> }> {
	return calls.map((call) => {
		const schema = tools.find((tool) => tool.name === call.name)?.parameters as ToolParameters | undefined;
		if (!schema || !Array.isArray(schema.required)) return call;
		const required = schema.required;
		const args = { ...call.arguments };
		for (const property of required) {
			if (args[property] !== undefined) continue;
			const unknown = Object.keys(args).filter((key) => schema.properties?.[key] === undefined);
			const source = ARGUMENT_ALIASES[property]?.find((alias) => alias in args) ??
				(unknown.length === 1 ? unknown[0] : undefined);
			if (source === undefined) continue;
			args[property] = args[source];
			delete args[source];
		}
		return { name: call.name, arguments: args };
	});
}
