import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { readdir, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve, join, relative, basename } from "node:path";

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

async function collectAllPaths(dir: string, rootDir: string, maxDepth?: number, depth = 0): Promise<string[]> {
	if (maxDepth !== undefined && depth >= maxDepth) return [];
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	const paths: string[] = [];
	for (const entry of entries) {
		if (entry.name === ".git") continue;
		const fullPath = join(dir, entry.name);
		const relPath = relative(rootDir, fullPath);
		paths.push(relPath);
		if (entry.isDirectory()) {
			paths.push(...await collectAllPaths(fullPath, rootDir, maxDepth, depth + 1));
		}
	}
	return paths;
}

export default function treeToolExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "tree",
		label: "Tree",
		description: "Display directory structure in a tree-like format. Respects .gitignore by default.",
		promptSnippet: "Show directory structure, respecting .gitignore",
		promptGuidelines: [
			"Use this tool instead of `ls` or `find` when exploring project structure",
			"Always use this first when entering a new project directory",
			"Use maxDepth to limit output for large directories",
			"Use includePatterns to filter for specific file types",
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

			try {
				await stat(targetPath);
			} catch {
				return {
					content: [{ type: "text", text: `Error: directory not found: ${targetPath}` }],
					details: { error: "not_found" },
				};
			}

			let gitIgnored = new Set<string>();
			if (params.respectGitignore !== false) {
				const allPaths = await collectAllPaths(targetPath, targetPath, params.maxDepth);
				gitIgnored = getGitIgnored(targetPath, allPaths);
			}

			const nodes = await walkDir(targetPath, {
				maxDepth: params.maxDepth,
				includePatterns: params.includePatterns,
				excludePatterns: params.excludePatterns,
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
