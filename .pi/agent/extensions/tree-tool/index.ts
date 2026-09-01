import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Container } from "@earendil-works/pi-tui";
import { Type } from "@sinclair/typebox";
import { readdir, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve, join, relative, basename } from "node:path";
import { buildToolBlock, WidthAwareLines } from "../compact-tools/cards";
import { ELAPSED_KEY } from "../compact-tools/constants";

/**
 * Dependency / cache / generated dirs skipped unless includeCacheDirs is true.
 * Basename exact match only — keep names high-precision (no build/dist/target/out).
 */
const CACHE_DIRS = new Set([
	// JS / TS / Bun / Node
	"node_modules",
	"bower_components",
	".pnpm-store",
	".parcel-cache",
	".turbo",
	".next",
	".nuxt",
	".svelte-kit",
	".angular",
	".nx",
	".vite",
	".vercel",
	".netlify",
	".output",
	// Python
	"__pycache__",
	".pytest_cache",
	".ruff_cache",
	".mypy_cache",
	".pytype",
	".pyre",
	".tox",
	".nox",
	".venv",
	".eggs",
	".hypothesis",
	".ipynb_checkpoints",
	"htmlcov",
	// Go / PHP / generic vendor
	"vendor",
	// Java / JVM
	".gradle",
	// Rust — target/ omitted (too generic as a basename)
	// C / C++
	"CMakeFiles",
	"cmake-build-debug",
	"cmake-build-release",
	// Swift / ObjC
	".build",
	"Pods",
	"DerivedData",
	// Dart / Flutter
	".dart_tool",
	// Haskell
	".stack-work",
	"dist-newstyle",
	// Elixir / Erlang / OCaml / Zig
	"_build",
	"zig-cache",
	"zig-out",
	// Terraform / infra
	".terraform",
	// Generic tooling cache
	".cache",
]);

function isCacheDir(name: string): boolean {
	return CACHE_DIRS.has(name);
}

/** True if any path segment is a known cache/vendor dir (posix or win separators). */
function pathHasCacheSegment(relPath: string): boolean {
	return relPath.split(/[/\\]/).some((seg) => seg.length > 0 && isCacheDir(seg));
}

/**
 * When includeCacheDirs is on, drop gitignore hits under cache/vendor dirs so a
 * single flag is enough to inspect them (node_modules is almost always ignored).
 * Other gitignored paths stay hidden. Target root that is itself a cache dir
 * clears the set entirely (children have no cache segment in their relPath).
 */
function applyCacheDirGitignoreBypass(
	gitIgnored: Set<string>,
	targetPath: string,
	includeCacheDirs: boolean,
): Set<string> {
	if (!includeCacheDirs || gitIgnored.size === 0) return gitIgnored;
	if (isCacheDir(basename(targetPath)) || pathHasCacheSegment(targetPath)) {
		return new Set();
	}
	return new Set([...gitIgnored].filter((p) => !pathHasCacheSegment(p)));
}

function globMatch(pattern: string, name: string): boolean {
	let pi = 0;
	let ni = 0;
	let starPi = -1;
	let starNi = -1;
	while (ni < name.length) {
		if (pi < pattern.length && (pattern[pi] === "?" || pattern[pi] === name[ni])) {
			pi++;
			ni++;
		} else if (pi < pattern.length && pattern[pi] === "*") {
			starPi = pi;
			starNi = ni;
			pi++;
		} else if (starPi >= 0) {
			pi = starPi + 1;
			starNi++;
			ni = starNi;
		} else {
			return false;
		}
	}
	while (pi < pattern.length && pattern[pi] === "*") pi++;
	return pi === pattern.length;
}

function getGitIgnored(dir: string, paths: string[]): Set<string> {
	if (paths.length === 0) return new Set();
	try {
		const input = paths.join("\n");
		const out = execFileSync("git", ["check-ignore", "--stdin"], {
			cwd: dir,
			input,
			encoding: "utf-8",
			maxBuffer: 10 * 1024 * 1024,
			stdio: ["pipe", "pipe", "pipe"],
		});
		return new Set(out.split("\n").filter(Boolean));
	} catch {
		return new Set();
	}
}

interface TreeNode {
	name: string;
	isDir: boolean;
	children?: TreeNode[];
}

interface WalkOpts {
	maxDepth?: number;
	includePatterns?: string[];
	excludePatterns?: string[];
	includeCacheDirs: boolean;
	gitIgnored: Set<string>;
	rootDir: string;
}

async function walkDir(dir: string, opts: WalkOpts, depth: number): Promise<TreeNode[]> {
	if (opts.maxDepth !== undefined && depth >= opts.maxDepth) return [];
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	entries.sort((a, b) => {
		if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
		return a.name.localeCompare(b.name);
	});
	const nodes: TreeNode[] = [];
	for (const entry of entries) {
		const fullPath = join(dir, entry.name);
		const relPath = relative(opts.rootDir, fullPath);
		if (entry.name === ".git") continue;
		if (!opts.includeCacheDirs && entry.isDirectory() && isCacheDir(entry.name)) continue;
		if (opts.gitIgnored.has(relPath)) continue;
		if (opts.excludePatterns?.some((p) => globMatch(p, entry.name))) continue;
		if (entry.isDirectory()) {
			const children = await walkDir(fullPath, opts, depth + 1);
			const hasInclude = opts.includePatterns && opts.includePatterns.length > 0;
			if (hasInclude && children.length === 0) continue;
			nodes.push({ name: entry.name, isDir: true, children });
		} else {
			if (opts.includePatterns && opts.includePatterns.length > 0) {
				if (!opts.includePatterns.some((p) => globMatch(p, entry.name))) continue;
			}
			nodes.push({ name: entry.name, isDir: false });
		}
	}
	return nodes;
}

function renderTree(nodes: TreeNode[], prefix: string): string[] {
	const lines: string[] = [];
	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i];
		const isLast = i === nodes.length - 1;
		const connector = isLast ? "└── " : "├── ";
		lines.push(prefix + connector + node.name);
		if (node.children && node.children.length > 0) {
			const childPrefix = prefix + (isLast ? "    " : "│   ");
			lines.push(...renderTree(node.children, childPrefix));
		}
	}
	return lines;
}

function countNodes(nodes: TreeNode[]): { dirs: number; files: number } {
	let dirs = 0;
	let files = 0;
	for (const node of nodes) {
		if (node.isDir) {
			dirs++;
			if (node.children) {
				const sub = countNodes(node.children);
				dirs += sub.dirs;
				files += sub.files;
			}
		} else {
			files++;
		}
	}
	return { dirs, files };
}

async function collectAllPaths(
	dir: string,
	rootDir: string,
	opts: { maxDepth?: number; includeCacheDirs: boolean },
	depth = 0,
): Promise<string[]> {
	if (opts.maxDepth !== undefined && depth >= opts.maxDepth) return [];
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	const paths: string[] = [];
	for (const entry of entries) {
		if (entry.name === ".git") continue;
		if (!opts.includeCacheDirs && entry.isDirectory() && isCacheDir(entry.name)) continue;
		const fullPath = join(dir, entry.name);
		const relPath = relative(rootDir, fullPath);
		paths.push(relPath);
		if (entry.isDirectory()) {
			paths.push(...await collectAllPaths(fullPath, rootDir, opts, depth + 1));
		}
	}
	return paths;
}

export default function treeToolExtension(pi: ExtensionAPI) {
	const startedAtByCallId = new Map<string, number>();
	const timerByCallId = new Map<string, ReturnType<typeof setInterval>>();

	pi.on("tool_execution_start", async (event) => {
		if (event.toolName !== "tree") return;
		if (!startedAtByCallId.has(event.toolCallId)) {
			startedAtByCallId.set(event.toolCallId, Date.now());
		}
	});

	pi.on("tool_execution_end", async (event) => {
		if (event.toolName !== "tree") return;
		startedAtByCallId.delete(event.toolCallId);
		const timer = timerByCallId.get(event.toolCallId);
		if (timer) clearInterval(timer);
		timerByCallId.delete(event.toolCallId);
	});

	pi.on("tool_result", async (event) => {
		if (event.toolName !== "tree") return;
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
		for (const timer of timerByCallId.values()) clearInterval(timer);
		timerByCallId.clear();
		startedAtByCallId.clear();
	});

	pi.registerTool({
		name: "tree",
		label: "Tree",
		renderShell: "self",
		renderCall(args, theme, context) {
			if (!context?.isPartial) return new Container();
			const id = context.toolCallId;
			let started = startedAtByCallId.get(id);
			if (started === undefined) {
				started = Date.now();
				startedAtByCallId.set(id, started);
			}
			if (!timerByCallId.has(id)) {
				const timer = setInterval(() => context.invalidate(), 1000);
				timer.unref?.();
				timerByCallId.set(id, timer);
			}
			return new WidthAwareLines(
				() =>
					buildToolBlock("tree", (args ?? {}) as Record<string, unknown>, {}, {
						isPartial: true,
						elapsedMs: Date.now() - started!,
					}),
				(text) => theme.bg("toolPendingBg", text),
			);
		},
		renderResult(result, options, theme, context) {
			if (options?.isPartial) return new Container();
			const isError = context?.isError ?? result?.isError ?? false;
			const id = context?.toolCallId;
			if (id) {
				const timer = timerByCallId.get(id);
				if (timer) clearInterval(timer);
				timerByCallId.delete(id);
			}
			const persisted = Number(result?.details?.[ELAPSED_KEY]);
			const started = id ? startedAtByCallId.get(id) : undefined;
			const elapsedMs = Number.isFinite(persisted)
				? persisted
				: started === undefined
					? 0
					: Math.max(0, Date.now() - started);
			const lines = buildToolBlock(
				"tree",
				(context?.args ?? {}) as Record<string, unknown>,
				result,
				{
					isError,
					expanded: options?.expanded ?? false,
					elapsedMs,
				},
			);
			return new WidthAwareLines(lines, (text) =>
				theme.bg(isError ? "toolErrorBg" : "toolSuccessBg", text),
			);
		},
		description:
			"Display directory structure in a tree-like format. Respects .gitignore by default. Skips dependency, cache, and generated-output dirs (node_modules, __pycache__, .venv, vendor, .next, .gradle, etc.) unless includeCacheDirs is true. When includeCacheDirs is true, .gitignore is also bypassed for those dirs only.",
		promptSnippet: "Show directory structure, respecting .gitignore; cache/vendor dirs off by default",
		promptGuidelines: [
			"Use this tool instead of `ls` or `find` when exploring project structure",
			"Always use this first when entering a new project directory",
			"Use maxDepth to limit output for large directories",
			"Use includePatterns to filter for specific file types",
			"Do not set includeCacheDirs unless you specifically need dependency/cache/generated dirs (node_modules, vendor, .venv, .next, …). That flag alone is enough; you do not also need respectGitignore: false for those dirs",
		],
		parameters: Type.Object({
			path: Type.String({
				description: "Directory path to display (relative or absolute)",
			}),
			maxDepth: Type.Optional(
				Type.Number({
					description: "Maximum depth to display (default: unlimited)",
					minimum: 1,
				})
			),
			respectGitignore: Type.Optional(
				Type.Boolean({
					description: "Respect .gitignore rules (default: true)",
					default: true,
				})
			),
			includeCacheDirs: Type.Optional(
				Type.Boolean({
					description:
					"Include dependency, cache, and generated-output dirs such as node_modules, vendor, __pycache__, .venv, .next, .gradle, .terraform (default: false). Must be true to tree inside those directories. Also bypasses .gitignore for those dirs and their contents only; other ignored paths stay hidden.",
					default: false,
				})
			),
			includePatterns: Type.Optional(
				Type.Array(
					Type.String({
						description: "Glob patterns to include (e.g., '*.ts', '*.md')",
					})
				)
			),
			excludePatterns: Type.Optional(
				Type.Array(
					Type.String({
						description: "Glob patterns to exclude",
					})
				)
			),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const cwd = ctx.cwd;
			const targetPath = resolve(cwd, params.path);
			const includeCacheDirs = params.includeCacheDirs === true;

			try {
				await stat(targetPath);
			} catch {
				return {
					content: [{ type: "text", text: `Error: directory not found: ${targetPath}` }],
					details: { error: "not_found" },
				};
			}

			const targetName = basename(targetPath);
			if (!includeCacheDirs && isCacheDir(targetName)) {
				return {
					content: [{
						type: "text",
						text: `Error: refusing to tree inside '${targetName}' without includeCacheDirs: true`,
					}],
					details: { error: "cache_dir_blocked", dir: targetName },
				};
			}

			let gitIgnored = new Set<string>();
			if (params.respectGitignore !== false) {
				const allPaths = await collectAllPaths(targetPath, targetPath, {
					maxDepth: params.maxDepth,
					includeCacheDirs,
				});
				gitIgnored = applyCacheDirGitignoreBypass(
					getGitIgnored(targetPath, allPaths),
					targetPath,
					includeCacheDirs,
				);
			}

			const nodes = await walkDir(targetPath, {
				maxDepth: params.maxDepth,
				includePatterns: params.includePatterns,
				excludePatterns: params.excludePatterns,
				includeCacheDirs,
				gitIgnored,
				rootDir: targetPath,
			}, 0);

			const { dirs, files } = countNodes(nodes);
			const lines = [basename(targetPath), ...renderTree(nodes, ""), "", `${dirs} directories, ${files} files`];
			const output = lines.join("\n");

			return {
				content: [{ type: "text", text: output }],
				details: {
					path: targetPath,
					args: [],
					lineCount: lines.length,
				},
			};
		},
	});
}
