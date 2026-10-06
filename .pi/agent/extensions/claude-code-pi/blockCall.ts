import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

/**
 * Fenced tool-call block protocol.
 *
 * Models behind text bridges mangle JSON string escaping inside long shell
 * commands (every `"` and newline needs `\"` and `\n`, and models miscount).
 * This format keeps tool calls as plain YAML inside a fenced block so
 * multiline shell is a raw `|` block scalar with zero escaping:
 *
 * ```pi-tool-call
 * name: bash
 * arguments:
 *   command: |
 *     STS=$(aws sts get-caller-identity --query Arn --output text 2>&1)
 *     echo "sts=$STS"
 *   timeout: 240
 * ```
 */

export type ParsedToolCall = { name: string; arguments: Record<string, any> };

const FENCE_RE = /```pi-tool-call[ \t]*\r?\n([\s\S]*?)[ \t]*\r?\n```/g;

/** Renders a tool call as a fenced block. Multiline strings become block scalars. */
export function renderBlockCall(name: string, arguments_: Record<string, unknown>): string {
	return "```pi-tool-call\n" + stringifyYaml({ name, arguments: arguments_ }) + "```";
}

/** Parses one fenced block body into a tool call, or undefined when invalid. */
export function parseYamlCall(body: string): ParsedToolCall | undefined {
	let value: unknown;
	try {
		value = parseYaml(body);
	} catch {
		return undefined;
	}
	if (typeof value !== "object" || value === null) return undefined;
	const candidate = value as Record<string, unknown>;
	if (typeof candidate.name !== "string" || candidate.name.length === 0) return undefined;
	const args = candidate.arguments;
	if (typeof args !== "object" || args === null || Array.isArray(args)) return undefined;
	return { name: candidate.name, arguments: args as Record<string, any> };
}

/** All valid ```pi-tool-call fenced blocks in a model reply, in order. */
export function parseBlockToolCalls(text: string): ParsedToolCall[] {
	const calls: ParsedToolCall[] = [];
	for (const match of text.matchAll(FENCE_RE)) {
		const call = parseYamlCall(match[1] ?? "");
		if (call) calls.push(call);
	}
	return calls;
}

/** True when the reply contains at least one fence marker, valid or not. */
export function containsBlockFence(text: string): boolean {
	return /```pi-tool-call/.test(text);
}
