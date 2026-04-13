import * as fs from "node:fs/promises";
import * as path from "node:path";
import { convertToLlm, serializeConversation, type ExtensionAPI, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { CapabilityContextBundle, CapabilityDef, CapabilityToolInput } from "./types";

function truncateHead(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars)}\n\n[truncated ${text.length - maxChars} chars]`;
}

function truncateTail(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	return `[truncated ${text.length - maxChars} chars]\n\n${text.slice(-maxChars)}`;
}

function numberLines(text: string): string {
	return text
		.split("\n")
		.map((line, index) => `${String(index + 1).padStart(4, " ")} | ${line}`)
		.join("\n");
}

function stripPathSigil(rawPath: string): string {
	return rawPath.trim().replace(/^@+/, "");
}

function toWorkspaceRelative(cwd: string, targetPath: string): string {
	const relative = path.relative(cwd, targetPath);
	return relative === "" ? "." : relative;
}

function dedupe<T>(values: T[]): T[] {
	return [...new Set(values)];
}

async function runCommand(
	pi: ExtensionAPI,
	command: string,
	args: string[],
	cwd: string,
	signal?: AbortSignal,
): Promise<string> {
	const result = await pi.exec(command, args, { cwd, signal, timeout: 15000 });
	return [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n").trim();
}

async function collectConversation(ctx: ExtensionContext, maxChars: number): Promise<string> {
	const messages = ctx.sessionManager.getBranch()
		.flatMap((entry) => entry.type === "message" ? [entry.message] : []);

	if (messages.length === 0) return "";
	return truncateTail(serializeConversation(convertToLlm(messages)), maxChars);
}

async function collectGitStatus(
	pi: ExtensionAPI,
	cwd: string,
	signal?: AbortSignal,
): Promise<string> {
	try {
		return await runCommand(pi, "git", ["status", "--short", "--branch"], cwd, signal);
	} catch {
		return "";
	}
}

async function collectChangedPaths(
	pi: ExtensionAPI,
	cwd: string,
	signal?: AbortSignal,
): Promise<string[]> {
	try {
		const raw = await runCommand(pi, "git", ["status", "--porcelain"], cwd, signal);
		if (!raw) return [];

		return dedupe(
			raw.split("\n")
				.map((line) => line.slice(3).trim())
				.filter(Boolean)
				.map((item) => item.includes(" -> ") ? item.split(" -> ").pop() ?? item : item)
				.map((item) => item.replace(/^"+|"+$/g, "")),
		);
	} catch {
		return [];
	}
}

async function collectTree(
	pi: ExtensionAPI,
	cwd: string,
	maxChars: number,
	signal?: AbortSignal,
): Promise<string> {
	try {
		const tree = await runCommand(pi, "tree", ["-a", "-L", "3", "--gitignore"], cwd, signal);
		if (tree) return truncateHead(tree, maxChars);
	} catch {}

	try {
		const fallback = await runCommand(
			pi,
			"bash",
			["-lc", "find . -maxdepth 3 | sort | head -n 250"],
			cwd,
			signal,
		);
		return truncateHead(fallback, maxChars);
	} catch {
		return "";
	}
}

async function collectGitDiff(
	pi: ExtensionAPI,
	cwd: string,
	paths: string[],
	maxChars: number,
	signal?: AbortSignal,
): Promise<string> {
	const pathArgs = paths.length > 0 ? ["--", ...paths] : [];
	const sections: string[] = [];

	for (const args of [
		["diff", "--no-ext-diff", ...pathArgs],
		["diff", "--cached", "--no-ext-diff", ...pathArgs],
	]) {
		try {
			const diff = await runCommand(pi, "git", args, cwd, signal);
			if (!diff) continue;
			const label = args.includes("--cached") ? "Cached Diff" : "Working Tree Diff";
			sections.push(`### ${label}\n${diff}`);
		} catch {}
	}

	return truncateHead(sections.join("\n\n"), maxChars);
}

async function renderPathContext(
	pi: ExtensionAPI,
	cwd: string,
	targetPath: string,
	maxChars: number,
	signal?: AbortSignal,
): Promise<string> {
	const relative = toWorkspaceRelative(cwd, targetPath);

	try {
		const stat = await fs.stat(targetPath);
		if (stat.isDirectory()) {
			try {
				const listing = await runCommand(
					pi,
					"tree",
					["-a", "-L", "2", "--gitignore", targetPath],
					cwd,
					signal,
				);
				return `## ${relative}\n${truncateHead(listing, maxChars)}`;
			} catch {
				return `## ${relative}\n[directory]`;
			}
		}

		const content = await fs.readFile(targetPath, "utf-8");
		if (content.includes("\u0000")) {
			return `## ${relative}\n[binary file skipped]`;
		}

		return `## ${relative}\n\`\`\`\n${numberLines(truncateHead(content, maxChars))}\n\`\`\``;
	} catch (error) {
		const message = error instanceof Error ? error.message : "unable to read";
		return `## ${relative}\n[unavailable: ${message}]`;
	}
}

function formatSections(sections: Array<{ title: string; content: string }>): string {
	return sections
		.filter((section) => section.content.trim().length > 0)
		.map((section) => `## ${section.title}\n${section.content.trim()}`)
		.join("\n\n");
}

export async function buildCapabilityContext(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	def: CapabilityDef,
	input: CapabilityToolInput,
	signal?: AbortSignal,
): Promise<CapabilityContextBundle> {
	const requestedPaths = dedupe(
		(input.paths ?? [])
			.map(stripPathSigil)
			.filter(Boolean)
			.map((value) => path.resolve(ctx.cwd, value)),
	);

	const changedPaths = def.includeChangedFiles
		? (await collectChangedPaths(pi, ctx.cwd, signal)).map((value) => path.resolve(ctx.cwd, value))
		: [];

	const autoPaths = dedupe([...requestedPaths, ...changedPaths]).slice(0, def.maxFiles);
	const sections: CapabilityContextBundle["sections"] = [
		{
			title: "Workspace",
			content: [
				`cwd: ${ctx.cwd}`,
				autoPaths.length > 0 ? `selected paths: ${autoPaths.map((item) => toWorkspaceRelative(ctx.cwd, item)).join(", ")}` : "",
			].filter(Boolean).join("\n"),
		},
	];

	if ((input.includeConversation ?? def.includeConversation) === true) {
		const conversation = await collectConversation(ctx, def.maxConversationChars);
		if (conversation) sections.push({ title: "Recent Conversation", content: conversation });
	}

	if (def.includeGitStatus) {
		const gitStatus = await collectGitStatus(pi, ctx.cwd, signal);
		if (gitStatus) sections.push({ title: "Git Status", content: gitStatus });
	}

	if ((input.includeTree ?? def.includeTree) === true) {
		const tree = await collectTree(pi, ctx.cwd, def.maxTreeChars, signal);
		if (tree) sections.push({ title: "Workspace Tree", content: tree });
	}

	if (autoPaths.length > 0) {
		const renderedPaths = await Promise.all(
			autoPaths.map((targetPath) => renderPathContext(pi, ctx.cwd, targetPath, def.maxFileChars, signal)),
		);
		sections.push({ title: "Path Context", content: renderedPaths.join("\n\n") });
	}

	if ((input.includeDiff ?? def.includeGitDiff) === true) {
		const diff = await collectGitDiff(
			pi,
			ctx.cwd,
			autoPaths.map((item) => toWorkspaceRelative(ctx.cwd, item)),
			def.maxGitDiffChars,
			signal,
		);
		if (diff) sections.push({ title: "Git Diff", content: diff });
	}

	return { sections, autoPaths: autoPaths.map((item) => toWorkspaceRelative(ctx.cwd, item)) };
}

export function buildCapabilityPrompt(
	task: string,
	context: CapabilityContextBundle,
): string {
	const renderedContext = formatSections(context.sections);
	return [
		"## Task",
		task.trim(),
		renderedContext ? "\n## Auto Context\n" + renderedContext : "",
	].filter(Boolean).join("\n");
}
