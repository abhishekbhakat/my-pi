/**
 * Claude Code native tool naming.
 *
 * Claude models are heavily trained to call Claude Code tools (Bash, Read,
 * Edit, ...) with the Anthropic <function_calls> XML format. The bridge
 * presents Pi tools under their Claude Code names and schemas so the model
 * works in the format it knows; every parsed call is translated back to the
 * Pi tool name and Pi argument names before Pi executes it.
 */

// Pi tool name -> Claude Code tool name. Unmapped tools keep their own name.
const PI_TO_CC: Record<string, string> = {
	bash: "Bash",
	read: "Read",
	write: "Write",
	edit: "Edit",
	grep: "Grep",
	find: "Glob",
	ls: "LS",
};

// Claude Code tool name -> Pi tool name.
const CC_TO_PI: Record<string, string> = Object.fromEntries(
	Object.entries(PI_TO_CC).map(([pi, cc]) => [cc, pi]),
);

// Pi argument name -> Claude Code argument name, per Pi tool.
const ARG_TO_CC: Record<string, Record<string, string>> = {
	read: { path: "file_path" },
	write: { path: "file_path" },
	edit: { path: "file_path", oldText: "old_string", newText: "new_string" },
};

// Claude Code argument name -> Pi argument name, per Claude Code tool.
const ARG_TO_PI: Record<string, Record<string, string>> = {};
for (const [piTool, args] of Object.entries(ARG_TO_CC)) {
	const ccTool = PI_TO_CC[piTool];
	ARG_TO_PI[ccTool] = Object.fromEntries(Object.entries(args).map(([piArg, ccArg]) => [ccArg, piArg]));
}

export function claudeToolName(piName: string): string {
	return PI_TO_CC[piName] ?? piName;
}

export function piToolName(claudeName: string): string {
	return CC_TO_PI[claudeName] ?? claudeName;
}

/** Rewrites a Pi tool schema for presentation: Claude Code name and argument names. */
export function toClaudeToolSchema(tool: { name: string; description: string; parameters: unknown }): {
	name: string;
	description: string;
	parameters: unknown;
} {
	let parameters = tool.parameters;
	if (parameters && typeof parameters === "object") {
		const argMap = ARG_TO_CC[tool.name];
		if (argMap) {
			parameters = renameJsonSchemaProperties(parameters, argMap);
		}
	}
	return { name: claudeToolName(tool.name), description: tool.description, parameters };
}

function renameJsonSchemaProperties(schema: unknown, argMap: Record<string, string>): unknown {
	if (!schema || typeof schema !== "object") return schema;
	const out: Record<string, unknown> = { ...(schema as Record<string, unknown>) };
	const props = out.properties;
	if (props && typeof props === "object" && !Array.isArray(props)) {
		const renamed: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
			renamed[argMap[key] ?? key] = value;
		}
		out.properties = renamed;
		if (out.required && Array.isArray(out.required)) {
			out.required = (out.required as string[]).map((name) => argMap[name] ?? name);
		}
	}
	return out;
}

export type ParsedToolCall = { name: string; arguments: Record<string, any> };

/** Presents arguments under Claude Code names for transcript rendering. */
export function toClaudeArguments(piName: string, args: Record<string, unknown>): Record<string, unknown> {
	const argMap = ARG_TO_CC[piName];
	if (!argMap) return args;
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(args)) out[argMap[key] ?? key] = value;
	return out;
}

/** Translates a parsed Claude Code tool call back to Pi tool name and arguments. */
export function toPiToolCall(call: ParsedToolCall): ParsedToolCall {
	const piName = piToolName(call.name);
	const argMap = ARG_TO_PI[call.name] ?? {};
	if (Object.keys(argMap).length === 0) return { name: piName, arguments: call.arguments };
	const args: Record<string, any> = {};
	for (const [key, value] of Object.entries(call.arguments)) args[argMap[key] ?? key] = value;
	return { name: piName, arguments: args };
}

function escapeXml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function unescapeXml(text: string): string {
	return text
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
		.replace(/&amp;/g, "&");
}

function coerceScalar(raw: string): unknown {
	const trimmed = raw.trim();
	if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
	if (trimmed === "true") return true;
	if (trimmed === "false") return false;
	if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
		try {
			return JSON.parse(trimmed);
		} catch {
			return raw;
		}
	}
	return raw;
}

/** Renders a tool call in the Anthropic <function_calls> XML format. */
export function renderXmlToolCall(name: string, args: Record<string, unknown>): string {
	const open = `<function_calls>\n<invoke name="${escapeXml(name)}">`;
	const params = Object.entries(args)
		.map(([key, value]) => {
			const tag = escapeXml(key);
			return `<parameter name="${tag}">\n${typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n</parameter>`;
		})
		.join("\n");
	return `${open}\n${params}\n</invoke>\n</function_calls>`;
}

const INVOKE_RE = /<invoke\s+name="([^"]*)"\s*>([\s\S]*?)<\/invoke>/g;
const PARAM_RE = /<parameter\s+name="([^"]*)"\s*>([\s\S]*?)<\/parameter>/g;

/** Parses Anthropic <function_calls> XML into tool calls. */
export function parseXmlToolCalls(text: string): ParsedToolCall[] {
	const calls: ParsedToolCall[] = [];
	for (const invoke of text.matchAll(INVOKE_RE)) {
		const name = unescapeXml(invoke[1] ?? "").trim();
		if (!name) continue;
		const args: Record<string, any> = {};
		for (const param of (invoke[2] ?? "").matchAll(PARAM_RE)) {
			const key = unescapeXml(param[1] ?? "").trim();
			if (!key) continue;
			const raw = (param[2] ?? "").replace(/^\n/, "").replace(/\n$/, "");
			args[key] = coerceScalar(raw);
		}
		calls.push({ name, arguments: args });
	}
	return calls;
}

/** True when the reply contains a function_calls block, well-formed or not. */
export function containsFunctionCalls(text: string): boolean {
	return text.includes("<function_calls>");
}
