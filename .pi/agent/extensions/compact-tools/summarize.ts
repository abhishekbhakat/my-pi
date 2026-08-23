import {
	CYAN,
	DIM,
	GREEN,
	HOME,
	RED,
	RESET,
	type ToolName,
} from "./constants";

export function oneLine(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

export function shortPath(path: string): string {
	if (!path) return "";
	return path === HOME || path.startsWith(`${HOME}/`) ? `~${path.slice(HOME.length)}` : path;
}

export function nonEmptyLineCount(value: string): number {
	return value.trim().split("\n").filter(Boolean).length;
}

export function formatElapsed(milliseconds: number): string {
	if (milliseconds < 1000) return "<1s";
	const seconds = Math.floor(milliseconds / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const remainder = seconds % 60;
	if (minutes < 60) return `${minutes}m ${remainder.toString().padStart(2, "0")}s`;
	return `${Math.floor(minutes / 60)}h ${(minutes % 60).toString().padStart(2, "0")}m`;
}

export function textFromResult(result: any): string {
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

function contentBlocks(result: any): any[] {
	const content = result?.content ?? result?.partialResult?.content;
	return Array.isArray(content) ? content : [];
}

function isImageReadResult(result: any, text: string): boolean {
	if (contentBlocks(result).some((item) => item?.type === "image")) return true;
	return /^Read image file\b/i.test(text.trim());
}

export function argDetail(name: ToolName, args: Record<string, unknown>): string {
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

export function summarize(
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
	if (name === "read") {
		if (isImageReadResult(result, text)) {
			const dim = text.match(/(\d+)x(\d+)/);
			return dim ? `${GREEN}image ${dim[1]}x${dim[2]}${RESET}` : `${GREEN}image${RESET}`;
		}
		return `${GREEN}${text.split("\n").length} lines${RESET}`;
	}
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
