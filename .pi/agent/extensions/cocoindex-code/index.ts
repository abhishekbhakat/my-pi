import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { execSync } from "node:child_process";

export default function cccExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "ccc-index",
		label: "CocoIndex Index",
		description: "Create/update the CocoIndex Code index for the current codebase. Run once per project or when the codebase changes significantly.",
		promptSnippet: "Index the codebase with CocoIndex Code",
		promptGuidelines: [
			"Run this before using ccc-search if the project hasn't been indexed yet",
			"Works on the current working directory",
		],
		parameters: Type.Object({}),

		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			try {
				const output = execSync("ccc init && ccc index", {
					encoding: "utf-8",
					cwd: ctx.cwd,
					maxBuffer: 10 * 1024 * 1024,
					timeout: 300_000,
				});

				return {
					content: [{ type: "text", text: output || "Index created/updated successfully." }],
					details: {},
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: message }],
					details: {},
					isError: true,
				};
			}
		},
	});

	pi.registerTool({
		name: "ccc-search",
		label: "CocoIndex Search",
		description: "Semantic code search using CocoIndex Code. Searches by meaning, not just keywords. Use when grep/ripgrep returns too many irrelevant results.",
		promptSnippet: "Semantic code search across the codebase",
		promptGuidelines: [
			"Use this when you need to find code by meaning, not exact keywords",
			"Combine with --lang or --path filters to narrow results",
			"Run ccc-index first if the project hasn't been indexed yet",
		],
		parameters: Type.Object({
			query: Type.String({
				description: "Search query — describe what you're looking for in natural language",
			}),
			lang: Type.Optional(
				Type.String({
					description: "Filter by language (e.g., python, typescript, rust)",
				})
			),
			path: Type.Optional(
				Type.String({
					description: "Filter by file path glob",
				})
			),
			limit: Type.Optional(
				Type.Number({
					description: "Maximum results to return (default: 10)",
					minimum: 1,
				})
			),
			offset: Type.Optional(
				Type.Number({
					description: "Number of results to skip (default: 0)",
					minimum: 0,
				})
			),
			refresh: Type.Optional(
				Type.Boolean({
					description: "Refresh index before searching",
					default: false,
				})
			),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const args: string[] = ["ccc", "search"];

			if (params.lang) args.push("--lang", params.lang);
			if (params.path) args.push("--path", params.path);
			if (params.limit !== undefined) args.push("--limit", params.limit.toString());
			if (params.offset !== undefined) args.push("--offset", params.offset.toString());
			if (params.refresh) args.push("--refresh");

			args.push(params.query);

			try {
				const output = execSync(args.join(" "), {
					encoding: "utf-8",
					cwd: ctx.cwd,
					maxBuffer: 10 * 1024 * 1024,
					timeout: 60_000,
				});

				return {
					content: [{ type: "text", text: output }],
					details: { query: params.query },
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: message }],
					details: {},
					isError: true,
				};
			}
		},
	});
}
