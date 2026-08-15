export const CLASSIFY_RULES = [
	"Classify one coding-agent user message.",
	"Return ONLY a JSON object. No markdown. No extra keys. No prose.",
	"",
	"Schema:",
	'{"kind":"question"|"instruction","lane":"ops"|"code"|"terminal"|null,"level":"basic"|"adv"|"readonly"|null,"needsCurrentThread":true|false,"includesEnglish":true|false}',
	"",
	"Rules:",
	"- question: user wants an explanation, status, or answer. No work to perform. lane and level MUST be null. needsCurrentThread false. includesEnglish false.",
	"- needsCurrentThread true: user is confirming, continuing, or answering the last assistant message (yes, ok, go, do it, proceed, continue). Stay on the current thread. includesEnglish false.",
	"- instruction: user wants work done.",
	"  - code: write, edit, review, or debug source",
	"  - terminal: raw shell, git, process, packages, install, build, test runners",
	"  - ops: files, config, deploy, infra, rename, organize, non-code repo work",
	"  - code and ops levels: basic or adv only. Never readonly.",
	"  - terminal levels, in this order:",
	"    1. readonly if EVERY command is inspect-only. Multi-step inspect is still readonly.",
	"       Examples: ls, tree, find (no -delete), grep/rg, cat/head/tail, git status/log/diff, lsof/ss/netstat, ps, df, env, which.",
	"    2. basic if any write, install, delete, chmod, kill, bind, or package change is a single local step.",
	"    3. adv if mutating work is multi-step, production, or unknown failure.",
	"    Uncertain whether a command writes? Use basic, never readonly.",
	"- includesEnglish true: an artifact contains prose a human will read — docs, README, commit message, changelog, sentence comments/docstrings, user-facing copy, error/UI strings, package.json description.",
	"- includesEnglish false: code, identifiers, incidental comments, renames, mechanical ops, and non-prose literals (paths, keys, codes, URLs). Chat reply is not an artifact.",
	"- User-facing or error/UI strings beat the literal exception: those are includesEnglish true.",
	"- Mixed or uncertain: includesEnglish MUST be true.",
	"- Mixed tasks: pick the dominant lane.",
].join("\n");

export function buildClassifyPrompt(lastAssistant?: string): string {
	const prior = lastAssistant
		? `\n\nLast assistant message:\n${lastAssistant}`
		: "\n\nLast assistant message: (none)";
	return `${CLASSIFY_RULES}${prior}`;
}

export const DECISION_JSON_SCHEMA = {
	type: "object",
	properties: {
		kind: { type: "string", enum: ["question", "instruction"] },
		lane: { anyOf: [{ type: "string", enum: ["ops", "code", "terminal"] }, { type: "null" }] },
		level: { anyOf: [{ type: "string", enum: ["basic", "adv", "readonly"] }, { type: "null" }] },
		needsCurrentThread: { type: "boolean" },
		includesEnglish: { type: "boolean" },
	},
	required: ["kind", "lane", "level", "needsCurrentThread", "includesEnglish"],
	additionalProperties: false,
};
