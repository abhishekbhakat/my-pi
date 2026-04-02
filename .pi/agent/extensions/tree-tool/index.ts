import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

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

			// Build tree command arguments
			const args: string[] = [];

			// Respect gitignore (default true)
			if (params.respectGitignore !== false) {
				args.push("--gitignore");
			}

			// Max depth
			if (params.maxDepth !== undefined) {
				args.push("-L", params.maxDepth.toString());
			}

			// Include patterns (using tree's -P for pattern matching)
			if (params.includePatterns && params.includePatterns.length > 0) {
				args.push("-P", params.includePatterns.join("|"));
			}

			// Exclude patterns (using tree's -I for ignore)
			if (params.excludePatterns && params.excludePatterns.length > 0) {
				args.push("-I", params.excludePatterns.join("|"));
			}

			// Add path at the end
			args.push(targetPath);

			try {
				const output = execSync(`tree ${args.join(" ")}`, {
					encoding: "utf-8",
					cwd,
					maxBuffer: 10 * 1024 * 1024, // 10MB buffer
				});

				return {
					content: [{ type: "text", text: output }],
					details: {
						path: targetPath,
						args,
						lineCount: output.split("\n").length - 1,
					},
				};
			} catch (error) {
				// tree command might not be installed, provide fallback
				if (error instanceof Error && "status" in error && error.status === 127) {
					return {
						content: [
							{
								type: "text",
								text: "Error: 'tree' command not found. Please install tree:\n  - macOS: brew install tree\n  - Ubuntu/Debian: apt-get install tree\n  - Fedora: dnf install tree",
							},
						],
						details: { error: "tree_not_installed" },
						isError: true,
					};
				}

				throw error;
			}
		},
	});
}
