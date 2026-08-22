/**
 * Justify Command Extension
 *
 * /justify runs markdown-table-justify/justify.py with no LLM call.
 *
 * Usage:
 *   /justify path/to/file.md
 *   /justify -w 100 README.md docs/api.md
 *   /justify --stdout table.md
 *   /justify README.md -o out.md
 */

import { execFile } from "node:child_process";
import { readdirSync, statSync, existsSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { copyToClipboard, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";

const execFileAsync = promisify(execFile);

const EXTENSION_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_REL = path.join("skills", "markdown-table-justify", "justify.py");
const FLAG_COMPLETIONS = ["-w", "--width", "--stdout", "-o", "--output"] as const;

type ParsedArgs = {
	width?: number;
	stdout: boolean;
	output?: string;
	paths: string[];
	error?: string;
};

function resolveScriptPath(): string | undefined {
	const candidates = [
		path.resolve(EXTENSION_DIR, "..", SKILL_REL),
		path.join(os.homedir(), ".pi", "agent", SKILL_REL),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}
	return undefined;
}

/** Resolve user path. Slash args skip Pi @-ref input transform, so handle here. */
function resolveUserPath(raw: string, cwd: string): string {
	let p = raw.trim();
	// @file or @"file with spaces" (Pi file picker syntax)
	if (p.startsWith("@")) p = p.slice(1);
	if (
		(p.startsWith('"') && p.endsWith('"') && p.length >= 2) ||
		(p.startsWith("'") && p.endsWith("'") && p.length >= 2)
	) {
		p = p.slice(1, -1);
	}
	if (p === "~") return os.homedir();
	if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
	if (path.isAbsolute(p)) return p;
	return path.resolve(cwd, p);
}

function parseArgs(raw: string): ParsedArgs {
	const tokens = raw.trim().split(/\s+/).filter(Boolean);
	const paths: string[] = [];
	let width: number | undefined;
	let stdout = false;
	let output: string | undefined;

	for (let i = 0; i < tokens.length; i++) {
		const tok = tokens[i];
		if (tok === "-w" || tok === "--width") {
			const next = tokens[++i];
			if (!next || !/^\d+$/.test(next)) {
				return { stdout: false, paths: [], error: "Usage: /justify [-w N] [--stdout] [-o out] <file.md>..." };
			}
			width = Number(next);
			if (width < 8) {
				return { stdout: false, paths: [], error: "width must be >= 8" };
			}
			continue;
		}
		if (tok === "--stdout") {
			stdout = true;
			continue;
		}
		if (tok === "-o" || tok === "--output") {
			const next = tokens[++i];
			if (!next) {
				return { stdout: false, paths: [], error: "Usage: /justify [-w N] [--stdout] [-o out] <file.md>..." };
			}
			output = next;
			continue;
		}
		if (tok.startsWith("-")) {
			return { stdout: false, paths: [], error: `Unknown flag: ${tok}` };
		}
		paths.push(tok);
	}

	if (paths.length === 0) {
		return {
			stdout: false,
			paths: [],
			error: "Usage: /justify [-w N] [--stdout] [-o out] <file.md>...",
		};
	}
	if (output && paths.length > 1) {
		return { stdout: false, paths: [], error: "-o/--output works with one input file only" };
	}
	if (stdout && output) {
		return { stdout: false, paths: [], error: "Use either --stdout or -o, not both" };
	}

	return { width, stdout, output, paths };
}

function buildScriptArgs(
	parsed: ParsedArgs,
	filePath: string,
	cwd: string,
): string[] {
	const args: string[] = [];
	if (parsed.width !== undefined) {
		args.push("-w", String(parsed.width));
	}
	if (parsed.stdout) args.push("--stdout");
	if (parsed.output) args.push("-o", resolveUserPath(parsed.output, cwd));
	args.push(filePath);
	return args;
}

async function runJustify(
	scriptPath: string,
	scriptArgs: string[],
	cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
	try {
		const { stdout, stderr } = await execFileAsync("uv", ["run", scriptPath, ...scriptArgs], {
			cwd,
			maxBuffer: 16 * 1024 * 1024,
			encoding: "utf8",
		});
		return { code: 0, stdout: stdout ?? "", stderr: stderr ?? "" };
	} catch (error) {
		const err = error as {
			code?: number | string;
			stdout?: string;
			stderr?: string;
			message?: string;
		};
		const code = typeof err.code === "number" ? err.code : 1;
		return {
			code,
			stdout: err.stdout ?? "",
			stderr: (err.stderr ?? err.message ?? "justify failed").trim(),
		};
	}
}

function pathCompletions(prefix: string): AutocompleteItem[] | null {
	const cwd = process.cwd();
	const at = prefix.startsWith("@");
	const bare = at ? prefix.slice(1) : prefix;
	const hasTrailingSep = bare.endsWith("/") || bare.endsWith(path.sep);
	const base = bare
		? hasTrailingSep
			? bare
			: path.dirname(bare) === "." && !bare.includes("/") && !bare.includes(path.sep)
				? ""
				: path.dirname(bare)
		: "";
	const namePrefix = hasTrailingSep ? "" : path.basename(bare);
	const dir = base ? path.resolve(cwd, base) : cwd;

	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return null;
	}

	const items: AutocompleteItem[] = [];
	for (const name of entries) {
		// Allow .pi / .md paths; skip other dotfiles at listing root only when no prefix.
		if (name.startsWith(".") && !namePrefix.startsWith(".") && name !== ".pi") continue;
		if (namePrefix && !name.startsWith(namePrefix)) continue;
		const full = path.join(dir, name);
		let isDir = false;
		try {
			isDir = statSync(full).isDirectory();
		} catch {
			continue;
		}
		const rel = base ? path.join(base, name) : name;
		const relPosix = rel.replaceAll("\\", "/");
		const body = isDir ? `${relPosix}/` : relPosix;
		// Prefer markdown-ish files and directories for this command.
		if (!isDir && !/\.(md|mdx|markdown|txt)$/i.test(name)) continue;
		const value = at ? `@${body}` : body;
		items.push({ value, label: value });
		if (items.length >= 25) break;
	}
	return items.length > 0 ? items : null;
}

function argumentCompletions(prefix: string): AutocompleteItem[] | null {
	const trimmed = prefix.trimStart();
	const tokens = trimmed.length === 0 ? [""] : trimmed.split(/\s+/);
	const current = tokens[tokens.length - 1] ?? "";
	const prev = tokens.length >= 2 ? tokens[tokens.length - 2] : "";

	if (prev === "-w" || prev === "--width") {
		return ["128", "100", "80", "64"]
			.filter((w) => w.startsWith(current))
			.map((w) => ({ value: w, label: w }));
	}
	if (current.startsWith("-")) {
		const flags = FLAG_COMPLETIONS.filter((f) => f.startsWith(current)).map((f) => ({
			value: f,
			label: f,
		}));
		return flags.length > 0 ? flags : null;
	}
	return pathCompletions(current);
}

export default function justifyExtension(pi: ExtensionAPI) {
	pi.registerCommand("justify", {
		description: "ASCII-justify markdown tables in a file (no LLM)",
		getArgumentCompletions: (prefix: string) => argumentCompletions(prefix),
		handler: async (args, ctx: ExtensionCommandContext) => {
			const parsed = parseArgs(args);
			if (parsed.error) {
				ctx.ui.notify(parsed.error, "warning");
				return;
			}

			const scriptPath = resolveScriptPath();
			if (!scriptPath) {
				ctx.ui.notify(
					"justify.py not found. Expected under ~/.pi/agent/skills/markdown-table-justify/ (run make install).",
					"error",
				);
				return;
			}

			const widthNote = parsed.width !== undefined ? ` (w=${parsed.width})` : "";
			const done: string[] = [];
			const stdoutChunks: string[] = [];

			for (const filePath of parsed.paths) {
				const resolved = resolveUserPath(filePath, ctx.cwd);
				if (!existsSync(resolved)) {
					ctx.ui.notify(`File not found: ${filePath}`, "error");
					return;
				}

				const scriptArgs = buildScriptArgs(parsed, resolved, ctx.cwd);
				const { code, stdout, stderr } = await runJustify(scriptPath, scriptArgs, ctx.cwd);
				if (code !== 0) {
					ctx.ui.notify(stderr || `justify failed (${code}) on ${filePath}`, "error");
					return;
				}

				if (parsed.stdout) stdoutChunks.push(stdout);
				else if (parsed.output) done.push(`${filePath} -> ${parsed.output}`);
				else done.push(filePath);
			}

			if (parsed.stdout) {
				const text = stdoutChunks.join("\n");
				let copied = false;
				if (text) {
					try {
						await copyToClipboard(text);
						copied = true;
					} catch {
						copied = false;
					}
				}
				const n = parsed.paths.length;
				const label = n === 1 ? parsed.paths[0] : `${n} files`;
				if (copied) ctx.ui.notify(`Justified ${label}${widthNote}. Copied.`, "info");
				else ctx.ui.notify(`Justified ${label}${widthNote}. Clipboard copy failed.`, "warning");
				return;
			}

			if (done.length === 1) ctx.ui.notify(`Justified ${done[0]}${widthNote}`, "info");
			else ctx.ui.notify(`Justified ${done.length} files${widthNote}: ${done.join(", ")}`, "info");
		},
	});
}
