// Vibe sometimes puts Python reprs of Mistral thinking chunks in assistant text.
// Decode only the literal subset used by those chunks; never evaluate model output.
class PythonLiteralReader {
	position: number;

	constructor(private readonly input: string, start: number) {
		this.position = start;
	}

	private skipSpace() {
		while (/\s/.test(this.input[this.position] ?? "") && this.position < this.input.length) this.position++;
	}

	private string(): string {
		const quote = this.input[this.position++];
		let result = "";
		while (this.position < this.input.length) {
			const char = this.input[this.position++];
			if (char === quote) return result;
			// Vibe has closed a double-quoted fragment with ' instead of ".
			if (quote === '"' && char === "'" && result.startsWith("'") && this.input.startsWith("}], 'closed':", this.position)) {
				return result;
			}
			if (char !== "\\") {
				result += char;
				continue;
			}
				if (this.position >= this.input.length) throw new Error("incomplete escape");
			const escape = this.input[this.position++];
			const common: Record<string, string> = {
				n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", a: "\x07",
				"\\": "\\", "'": "'", '"': '"',
			};
			if (escape in common) {
				result += common[escape];
			} else if (escape === "x" || escape === "u" || escape === "U") {
				const count = escape === "x" ? 2 : escape === "u" ? 4 : 8;
				const hex = this.input.slice(this.position, this.position + count);
				if (!new RegExp(`^[0-9a-fA-F]{${count}}$`).test(hex)) throw new Error("invalid unicode escape");
				const point = Number.parseInt(hex, 16);
				if (point > 0x10ffff) throw new Error("invalid code point");
				result += String.fromCodePoint(point);
				this.position += count;
			} else {
				// Python repr preserves unknown escapes (for example, \\q).
				result += `\\${escape}`;
			}
		}
		throw new Error("unterminated string");
	}

	read(depth = 0): unknown {
		if (depth > 32) throw new Error("nested literal");
		this.skipSpace();
		const char = this.input[this.position];
		if (char === "'" || char === '"') return this.string();
		if (char === "{" || char === "[") {
			this.position++;
			const array = char === "[";
			const result: any = array ? [] : Object.create(null);
			const end = array ? "]" : "}";
			this.skipSpace();
			while (this.input[this.position] !== end) {
				if (this.position >= this.input.length) throw new Error("unterminated literal");
				if (array) {
					result.push(this.read(depth + 1));
				} else {
					const key = this.read(depth + 1);
					if (typeof key !== "string") throw new Error("non-string key");
					this.skipSpace();
					if (this.input[this.position++] !== ":") throw new Error("missing colon");
					result[key] = this.read(depth + 1);
				}
				this.skipSpace();
				if (this.input[this.position] === end) break;
				// Vibe has also emitted a text fragment missing its } before ].
				if (!array && this.input[this.position] === "]" && result.type === "text" && typeof result.text === "string") {
					return result;
				}
				if (this.input[this.position++] !== ",") throw new Error("missing comma");
				this.skipSpace();
			}
			this.position++;
			return result;
		}
		for (const [literal, value] of [["True", true], ["False", false], ["None", null]] as const) {
			if (this.input.startsWith(literal, this.position)) {
				this.position += literal.length;
				return value;
			}
		}
		throw new Error("unsupported literal");
	}
}

function thinkingFragments(value: unknown): string | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	const block = value as { type?: unknown; thinking?: unknown };
	if (block.type !== "thinking" || !Array.isArray(block.thinking)) return undefined;
	const fragments: string[] = [];
	for (const fragment of block.thinking) {
		if (fragment?.type !== "text" || typeof fragment.text !== "string") return undefined;
		fragments.push(fragment.text);
	}
	return fragments.join("");
}

export function splitReprThinking(text: string): { text: string; thinking: string } {
	let position = 0;
	const thoughts: string[] = [];
	while (position < text.length) {
		const start = position;
		while (/\s/.test(text[position] ?? "") && position < text.length) position++;
		// Match only the leaked prefix, not a dictionary quoted in an answer.
		if (!text.startsWith("{'type': 'thinking'", position)) {
			position = start;
			break;
		}
		const reader = new PythonLiteralReader(text, position);
		try {
			const thinking = thinkingFragments(reader.read());
			if (thinking === undefined) {
				position = start;
				break;
			}
			thoughts.push(thinking);
			position = reader.position;
		} catch {
			position = start;
			break;
		}
	}
	return { thinking: thoughts.join(""), text: thoughts.length ? text.slice(position).trimStart() : text };
}
