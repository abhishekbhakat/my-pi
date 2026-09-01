import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
	BOLD,
	CYAN,
	DIM,
	GREEN,
	GUTTER,
	INDENT,
	MAGENTA,
	RED,
	RESET,
	type ToolName,
	YELLOW,
} from "./constants";
import { argDetail, formatElapsed, summarize, textFromResult } from "./summarize";

function style(name: ToolName): { icon: string; color: string } {
	if (name === "bash") return { icon: "$", color: MAGENTA };
	if (name === "write" || name === "edit") return { icon: "~", color: YELLOW };
	if (name === "grep") return { icon: "/", color: CYAN };
	if (name === "find") return { icon: "*", color: CYAN };
	if (name === "ls") return { icon: ":", color: CYAN };
	if (name === "tree") return { icon: "\u251C", color: CYAN };
	return { icon: ">", color: CYAN }; // read
}

function colorizeDiff(diff: string): string[] {
	return diff.split("\n").map((line) => {
		if (line.startsWith("+") && !line.startsWith("+++")) return `${GREEN}${line}${RESET}`;
		if (line.startsWith("-") && !line.startsWith("---")) return `${RED}${line}${RESET}`;
		if (line.startsWith("@@")) return `${CYAN}${line}${RESET}`;
		return `${DIM}${line}${RESET}`;
	});
}

function expandedLines(name: ToolName, args: Record<string, unknown>, result: any): string[] {
	const out: string[] = [];

	if (name === "bash" && typeof args.command === "string") {
		const cmdLines = args.command.replace(/\s+$/, "").split("\n");
		cmdLines.forEach((line, index) => {
			const prefix = index === 0 ? `${CYAN}$ ${RESET}` : `${DIM}  ${RESET}`;
			out.push(`${INDENT}${prefix}${CYAN}${line}${RESET}`);
		});
	}

	if (name === "write" && typeof args.content === "string") {
		if (args.content.length === 0) {
			out.push(`${INDENT}${DIM}(empty file)${RESET}`);
			return out;
		}
		const splitLines = args.content.split("\n");
		const contentLines = args.content.endsWith("\n") ? splitLines.slice(0, -1) : splitLines;
		const width = String(contentLines.length).length;
		contentLines.forEach((line, index) => {
			const n = String(index + 1).padStart(width, " ");
			out.push(`${INDENT}${DIM}${n} ${RESET}${line}`);
		});
		return out;
	}

	const diff = result?.details?.diff as string | undefined;
	if (diff?.trim()) {
		for (const line of colorizeDiff(diff)) out.push(`${INDENT}${line}`);
		return out;
	}

	const text = textFromResult(result).replace(/\s+$/, "");
	if (text) {
		for (const raw of text.split("\n")) out.push(`${INDENT}${DIM}${raw}${RESET}`);
	}
	return out;
}

function fitToolLine(line: string, width: number): string {
	const max = Math.max(1, width);
	if (visibleWidth(line) <= max) return line;
	const arrowIndex = line.indexOf("→");
	if (arrowIndex < 0) return truncateToWidth(line, max, "…");
	const tail = line.slice(arrowIndex);
	const tailWidth = visibleWidth(tail);
	if (tailWidth >= max) return truncateToWidth(tail, max, "…");
	const head = line.slice(0, arrowIndex).trimEnd();
	return `${truncateToWidth(head, max - tailWidth - 1, "…")} ${tail}`;
}

export class WidthAwareLines {
	private readonly source: string[] | (() => string[]);
	private readonly background?: (text: string) => string;

	constructor(source: string[] | (() => string[]), background?: (text: string) => string) {
		this.source = source;
		this.background = background;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const max = Math.max(1, width);
		const lines = typeof this.source === "function" ? this.source() : this.source;
		return lines.map((line) => {
			const fitted = fitToolLine(line, max);
			if (!this.background) return fitted;
			const padded = fitted + " ".repeat(Math.max(0, max - visibleWidth(fitted)));
			return padded
				.split(RESET)
				.map((segment) => this.background!(`${segment}${RESET}`))
				.join("");
		});
	}
}

export function buildToolBlock(
	name: ToolName,
	args: Record<string, unknown>,
	result: any,
	opts: { isError?: boolean; isPartial?: boolean; expanded?: boolean; elapsedMs?: number } = {},
): string[] {
	const { isError = false, isPartial = false, expanded = false, elapsedMs = 0 } = opts;
	const detail = argDetail(name, args);
	const { icon, color } = style(name);
	const mark = isPartial
		? `${DIM}·${RESET}`
		: isError
			? `${RED}✗${RESET}`
			: `${GREEN}✓${RESET}`;
	const summary = isPartial
		? `${DIM}${formatElapsed(elapsedMs)}${RESET}`
		: summarize(name, result, isError, args, elapsedMs);
	const line2 = !detail
		? `${INDENT}${DIM}→${RESET} ${summary}`
		: `${INDENT}${DIM}${detail}${RESET} ${DIM}→${RESET} ${summary}`;

	const lines = [`${GUTTER} ${mark} ${color}${icon} ${BOLD}${name}${RESET}`, line2];
	if (expanded && !isPartial) lines.push(...expandedLines(name, args, result));
	return lines;
}
