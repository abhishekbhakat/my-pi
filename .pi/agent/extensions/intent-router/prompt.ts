import type { ToolInfo } from "./types";

export const CLASSIFY_RULES = [
	"Classify one coding-agent user message.",
	"Return ONLY a JSON object. No markdown. No extra keys. No prose.",
	"",
	"Schema:",
	'{"kind":"question"|"instruction","lane":"ops"|"code"|"terminal"|null,"level":"basic"|"adv"|null,"tool":"<tool-name>"|null,"needsCurrentThread":true|false,"includesEnglish":true|false}',
	"",
	"Rules:",
	"- question: user wants an explanation, status, or answer. No work to perform. lane, level, and tool MUST be null. needsCurrentThread false. includesEnglish false.",
	"- needsCurrentThread true: user is confirming, continuing, or answering the last assistant message (yes, ok, go, do it, proceed, continue). Stay on the current thread. tool MUST be null. includesEnglish false.",
	"- instruction: user wants work done.",
	"  - If the user asks to run, use, or invoke a listed tool, set tool to that exact name.",
	'  - "run tree", "use tree", "tree this folder" is tool=tree. It is NOT terminal and NOT a shell command.',
	"  - tool MUST be one of the listed tool names, or null. Never invent a tool name.",
	"  - If tool is set, includesEnglish MUST be false. A named tool invoke is a tool call, not English writing.",
	"  - code: write, edit, review, or debug source",
	"  - terminal: raw shell, git, process, packages, install, build, test runners — only when no listed tool matches",
	"  - ops: files, config, deploy, infra, rename, organize, non-code repo work",
	"  - basic: single obvious step, local, low risk",
	"  - adv: multi-step, design, architecture, production, or unknown failure",
	"- includesEnglish true: an artifact contains prose a human will read — docs, README, commit message, changelog, sentence comments/docstrings, user-facing copy, error/UI strings, package.json description.",
	"- includesEnglish false: code, identifiers, incidental comments, renames, mechanical ops, and non-prose literals (paths, keys, codes, URLs). Chat reply is not an artifact.",
	"- User-facing or error/UI strings beat the literal exception: those are includesEnglish true.",
	"- Mixed or uncertain: includesEnglish MUST be true.",
	"- Mixed tasks: pick the dominant lane. Prefer a listed tool when the user named it.",
].join("\n");

export function buildClassifyPrompt(tools: ToolInfo[], lastAssistant?: string): string {
	const lines = tools.length
		? tools.map((tool) => `- ${tool.name}: ${tool.description.slice(0, 80)}`)
		: ["- (none)"];
	const prior = lastAssistant
		? `\n\nLast assistant message:\n${lastAssistant}`
		: "\n\nLast assistant message: (none)";
	return `${CLASSIFY_RULES}\n\nActive tools:\n${lines.join("\n")}${prior}`;
}

export const DECISION_JSON_SCHEMA = {
	type: "object",
	properties: {
		kind: { type: "string", enum: ["question", "instruction"] },
		lane: { anyOf: [{ type: "string", enum: ["ops", "code", "terminal"] }, { type: "null" }] },
		level: { anyOf: [{ type: "string", enum: ["basic", "adv"] }, { type: "null" }] },
		tool: { anyOf: [{ type: "string" }, { type: "null" }] },
		needsCurrentThread: { type: "boolean" },
		includesEnglish: { type: "boolean" },
	},
	required: ["kind", "lane", "level", "tool", "needsCurrentThread", "includesEnglish"],
	additionalProperties: false,
};
