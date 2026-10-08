import { lexer, type Token } from "marked";

const COMMIT_TYPE_RE =
	/^(feat|fix|refactor|docs|style|test|chore|perf|ci|build)(\([^)]+\))?:\s+\S/i;

const PREAMBLE_RE =
	/^(the staged|here(?:'s| is)|a fitting|based on|looking at|this change|i (?:would|will)|suggested? message|commit message)\b/i;

function markdownPlain(token: Token): string {
	if ((token.type === "code" || token.type === "codespan") && typeof token.text === "string") return token.text;
	if (token.type === "list" && Array.isArray(token.items)) {
		return token.items
			.map((item: Token) => markdownPlain(item))
			.filter((part: string) => part.length > 0)
			.join("\n");
	}
	if ("tokens" in token && Array.isArray(token.tokens) && token.tokens.length > 0) {
		return token.tokens.map((child) => markdownPlain(child)).join("");
	}
	if ("text" in token && typeof token.text === "string") return token.text;
	return "";
}

function stripWrapQuotes(line: string): string {
	let out = line.trim();
	for (let i = 0; i < 3 && out.length >= 2; i++) {
		const first = out[0];
		const last = out[out.length - 1];
		if (
			(first === '"' && last === '"') ||
			(first === "'" && last === "'") ||
			(first === "`" && last === "`")
		) {
			out = out.slice(1, -1).trim();
		} else {
			break;
		}
	}
	return out;
}

/** Keep one pasteable conventional commit line; drop haiku preamble fluff. */
export function cleanCommitMessage(text: string): string {
	let plain = text;
	try {
		plain = lexer(text)
			.map((token) => markdownPlain(token))
			.filter((part) => part.trim().length > 0)
			.join("\n");
	} catch {
		plain = text;
	}

	const lines = plain
		.split(/\r?\n/)
		.map((part) => stripWrapQuotes(part))
		.filter((part) => part.length > 0);

	const conventional = lines.find((line) => COMMIT_TYPE_RE.test(line) && line.length <= 128);
	if (conventional) return conventional;

	const fallback =
		lines.find(
			(line) =>
				line.length <= 128 &&
				!PREAMBLE_RE.test(line) &&
				!/:\s*$/.test(line) &&
				!/^```/.test(line),
		) ?? "";
	return fallback;
}
