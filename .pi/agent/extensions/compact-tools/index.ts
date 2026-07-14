/**
 * Compact tool cards for Pi built-ins.
 *
 * Restyles read / write / edit / bash / grep / find / ls with tidy-style
 * two-line blocks. Execution stays native. Expand (ctrl+o) shows full detail.
 *
 *   ┊ ✓ $ bash
 *   ┊     rg -n foo src → done in 1s
 *
 *   ┊ ✓ > read
 *   ┊     ~/proj/a.ts → 42 lines
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	createBashTool,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadTool,
	createWriteTool,
} from "@earendil-works/pi-coding-agent";
import { Container, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { homedir } from "node:os";

const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const MAGENTA = "\x1b[35m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

const LEAD = "  ";
const GUTTER = `${LEAD}${DIM}${String.fromCharCode(0x250a)}${RESET}`;
const INDENT = `${GUTTER}   `;
const ELAPSED_KEY = "compactToolsElapsedMs";
const HOME = homedir();

const TOOL_NAMES = ["read", "write", "edit", "bash", "grep", "find", "ls"] as const;
type ToolName = (typeof TOOL_NAMES)[number];

type BuiltInTools = {
	read: ReturnType<typeof createReadTool>;
	write: ReturnType<typeof createWriteTool>;
	edit: ReturnType<typeof createEditTool>;
	bash: ReturnType<typeof createBashTool>;
	grep: ReturnType<typeof createGrepTool>;
	find: ReturnType<typeof createFindTool>;
	ls: ReturnType<typeof createLsTool>;
};

const toolCache = new Map<string, BuiltInTools>();

function getTools(cwd: string): BuiltInTools {
	let tools = toolCache.get(cwd);
	if (!tools) {
		tools = {
			read: createReadTool(cwd),
			write: createWriteTool(cwd),
			edit: createEditTool(cwd),
			bash: createBashTool(cwd),
			grep: createGrepTool(cwd),
			find: createFindTool(cwd),
			ls: createLsTool(cwd),
		};
		toolCache.set(cwd, tools);
	}
	return tools;
}

function style(name: ToolName): { icon: string; color: string } {
	if (name === "bash") return { icon: "$", color: MAGENTA };
	if (name === "write" || name === "edit") return { icon: "~", color: YELLOW };
	if (name === "grep") return { icon: "/", color: CYAN };
	if (name === "find") return { icon: "*", color: CYAN };
	if (name === "ls") return { icon: ":", color: CYAN };
	return { icon: ">", color: CYAN }; // read
}

function oneLine(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function shortPath(path: string): string {
	if (!path) return "";
	return path === HOME || path.startsWith(`${HOME}/`) ? `~${path.slice(HOME.length)}` : path;
}

function nonEmptyLineCount(value: string): number {
	return value.trim().split("\n").filter(Boolean).length;
}

function formatElapsed(milliseconds: number): string {
	if (milliseconds < 1000) return "<1s";
	const seconds = Math.floor(milliseconds / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const remainder = seconds % 60;
	if (minutes < 60) return `${minutes}m ${remainder.toString().padStart(2, "0")}s`;
	return `${Math.floor(minutes / 60)}h ${(minutes % 60).toString().padStart(2, "0")}m`;
}

function textFromResult(result: any): string {
	const content = result?.content ?? result?.partialResult?.content;
	if (Array.isArray(content)) {
		const block = content.find((item: any) => item?.type === "text");
		if (block?.text) return block.text;
	}
	if (typeof result?.output === "string") return result.output;
	if (typeof result?.error === "string") return result.error;
	if (typeof result?.message === "string") return result.message;
	if (typeof result?.details?.error === "string") return result.details.error;
	return "";
}

function argDetail(name: ToolName, args: Record<string, unknown>): string {
	if (name === "bash" && typeof args.command === "string") return oneLine(args.command);
	if ((name === "grep" || name === "find") && typeof args.pattern === "string") {
		const pattern = oneLine(args.pattern);
		return typeof args.path === "string" ? `${pattern} in ${shortPath(args.path)}` : pattern;
	}
	if (typeof args.path === "string") return shortPath(oneLine(args.path));
	if (typeof args.name === "string") return oneLine(args.name);
	return "";
}

function grepResultCounts(text: string): { matches: number; files: number } {
	if (/^No matches found/.test(text.trim())) return { matches: 0, files: 0 };

	const nativeMatches = text
		.split("\n")
		.map((line) => line.match(/^(.+):\d+:/))
		.filter((match): match is RegExpMatchArray => match !== null);
	if (nativeMatches.length > 0) {
		return {
			matches: nativeMatches.length,
			files: new Set(nativeMatches.map((match) => match[1])).size,
		};
	}

	let currentFile: string | undefined;
	let matches = 0;
	const files = new Set<string>();
	for (const line of text.split("\n")) {
		if (/^\S/.test(line)) currentFile = line.trim();
		else if (currentFile && /^\s+\d+:/.test(line)) {
			matches++;
			files.add(currentFile);
		}
	}
	if (matches > 0) return { matches, files: files.size };
	return { matches: text.trim().split("\n").filter(Boolean).length, files: 0 };
}

function summarize(
	name: ToolName,
	result: any,
	isError: boolean,
	args: Record<string, unknown>,
	elapsedMs: number,
): string {
	const text = textFromResult(result);
	if (isError) {
		if (name === "bash") return `${RED}error${RESET} ${DIM}in ${formatElapsed(elapsedMs)}${RESET}`;
		return `${RED}${text.split("\n")[0] || "error"}${RESET}`;
	}
	if (name === "read") return `${GREEN}${text.split("\n").length} lines${RESET}`;
	if (name === "write") {
		if (typeof args.content === "string" && !args.content.includes("\0")) {
			const lines =
				args.content.length === 0
					? 0
					: (args.content.match(/\n/g)?.length ?? 0) + (args.content.endsWith("\n") ? 0 : 1);
			return `${GREEN}${lines}${RESET} ${DIM}${lines === 1 ? "line" : "lines"}${RESET}`;
		}
		const bytes = text.match(/wrote (\d+) bytes/i)?.[1];
		return bytes ? `${GREEN}${bytes}b${RESET}` : `${GREEN}written${RESET}`;
	}
	if (name === "edit") {
		const diff = result?.details?.diff as string | undefined;
		if (!diff) return `${GREEN}applied${RESET}`;
		let add = 0;
		let del = 0;
		for (const line of diff.split("\n")) {
			if (line.startsWith("+") && !line.startsWith("+++")) add++;
			if (line.startsWith("-") && !line.startsWith("---")) del++;
		}
		return `${GREEN}+${add}${RESET}${DIM}/${RESET}${RED}-${del}${RESET}`;
	}
	if (name === "bash") {
		const match = text.match(/exit code: (\d+)/);
		const exit = match ? Number(match[1]) : null;
		const status = exit && exit !== 0 ? `${RED}exit ${exit}` : `${GREEN}done`;
		return `${status}${RESET} ${DIM}in ${formatElapsed(elapsedMs)}${RESET}`;
	}
	if (name === "grep") {
		const { matches, files } = grepResultCounts(text);
		const matchLabel = matches === 1 ? "match" : "matches";
		const fileLabel = files === 1 ? "file" : "files";
		return `${GREEN}${matches} ${matchLabel}${RESET} ${DIM}in${RESET} ${CYAN}${files} ${fileLabel}${RESET}`;
	}
	const count = nonEmptyLineCount(text);
	const noun = name === "find" ? "files" : name === "ls" ? "entries" : "results";
	return `${DIM}${count} ${noun}${RESET}`;
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

class WidthAwareLines {
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

function buildToolBlock(
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

export default function (pi: ExtensionAPI) {
	const seed = getTools(process.cwd());
	const startedAtByCallId = new Map<string, number>();
	const elapsedTimerByCallId = new Map<string, ReturnType<typeof setInterval>>();
	const owned = new Set<string>(TOOL_NAMES);

	function stopTimer(id: string | undefined): void {
		if (!id) return;
		const timer = elapsedTimerByCallId.get(id);
		if (timer) clearInterval(timer);
		elapsedTimerByCallId.delete(id);
	}

	function ensureTimer(id: string, invalidate: () => void): number {
		let started = startedAtByCallId.get(id);
		if (started === undefined) {
			started = Date.now();
			startedAtByCallId.set(id, started);
		}
		if (!elapsedTimerByCallId.has(id)) {
			const timer = setInterval(() => invalidate(), 1000);
			timer.unref?.();
			elapsedTimerByCallId.set(id, timer);
		}
		return started;
	}

	function elapsedFor(id: string | undefined, result: any): number {
		const persisted = Number(result?.details?.[ELAPSED_KEY]);
		if (Number.isFinite(persisted)) return persisted;
		const started = id ? startedAtByCallId.get(id) : undefined;
		return started === undefined ? 0 : Math.max(0, Date.now() - started);
	}

	pi.on("tool_execution_start", async (event) => {
		if (!owned.has(event.toolName)) return;
		if (!startedAtByCallId.has(event.toolCallId)) {
			startedAtByCallId.set(event.toolCallId, Date.now());
		}
	});

	pi.on("tool_execution_end", async (event) => {
		if (!owned.has(event.toolName)) return;
		stopTimer(event.toolCallId);
	});

	pi.on("tool_result", async (event) => {
		if (!owned.has(event.toolName)) return;
		const started = startedAtByCallId.get(event.toolCallId);
		if (started === undefined) return;
		return {
			details: {
				...(event.details ?? {}),
				[ELAPSED_KEY]: Math.max(0, Date.now() - started),
			},
		};
	});

	pi.on("session_shutdown", async () => {
		for (const timer of elapsedTimerByCallId.values()) clearInterval(timer);
		elapsedTimerByCallId.clear();
		startedAtByCallId.clear();
	});

	function register(name: ToolName, source: BuiltInTools[ToolName], description?: string): void {
		pi.registerTool({
			name,
			label: name,
			description: description ?? source.description,
			parameters: source.parameters,
			promptSnippet: (source as any).promptSnippet,
			promptGuidelines: (source as any).promptGuidelines,
			renderShell: "self",
			async execute(toolCallId, params, signal, onUpdate, ctx) {
				const tools = getTools(ctx.cwd);
				return tools[name].execute(toolCallId, params as never, signal, onUpdate);
			},
			renderCall(args, theme, context) {
				if (!context?.isPartial) return new Container();
				const id = context.toolCallId;
				const started = ensureTimer(id, () => context.invalidate());
				return new WidthAwareLines(
					() =>
						buildToolBlock(name, (args ?? {}) as Record<string, unknown>, {}, {
							isPartial: true,
							elapsedMs: Date.now() - started,
						}),
					(text) => theme.bg("toolPendingBg", text),
				);
			},
			renderResult(result, options, theme, context) {
				if (options?.isPartial) return new Container();
				const isError = context?.isError ?? result?.isError ?? false;
				const id = context?.toolCallId;
				stopTimer(id);
				const lines = buildToolBlock(
					name,
					(context?.args ?? {}) as Record<string, unknown>,
					result,
					{
						isError,
						expanded: options?.expanded ?? false,
						elapsedMs: elapsedFor(id, result),
					},
				);
				return new WidthAwareLines(lines, (text) =>
					theme.bg(isError ? "toolErrorBg" : "toolSuccessBg", text),
				);
			},
		});
	}

	register("read", seed.read);
	register("write", seed.write);
	register("edit", seed.edit);
	register(
		"bash",
		seed.bash,
		"Execute bash commands (`tree --gitignore`, `ls`, `rg`,  etc.)",
	);
	register("grep", seed.grep);
	register("find", seed.find);
	register("ls", seed.ls);
}
