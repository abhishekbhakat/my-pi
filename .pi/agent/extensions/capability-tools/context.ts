import * as fs from "node:fs/promises";
import * as path from "node:path";
import { convertToLlm, serializeConversation, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { collectActionTimeline } from "./timeline";
import type { CapabilityContextBundle, CapabilityContextSection, CapabilityDef, CapabilityToolInput } from "./types";

type PathKind = "code" | "structured" | "directory" | "skipped";

interface PathBlock {
	relative: string;
	explicit: boolean;
	kind: PathKind;
	content: string;
}

const STRUCTURED_EXTENSIONS = new Set([
	".json",
	".yaml",
	".yml",
	".toml",
	".xml",
	".ini",
	".cfg",
	".conf",
]);

// Lower index = higher keep priority when over budget.
const SECTION_PRIORITY: Record<string, string[]> = {
	patch_reviewer: [
		"Workspace",
		"Git Diff",
		"Path Context",
		"Git Status",
		"Recent Conversation",
		"Action Timeline",
		"Workspace Tree",
	],
	code_scout: [
		"Workspace",
		"Path Context",
		"Workspace Tree",
		"Git Status",
		"Recent Conversation",
		"Action Timeline",
		"Git Diff",
	],
	reasoning_coach: [
		"Workspace",
		"Recent Conversation",
		"Action Timeline",
		"Path Context",
		"Git Status",
		"Workspace Tree",
		"Git Diff",
	],
	default: [
		"Workspace",
		"Git Diff",
		"Path Context",
		"Recent Conversation",
		"Action Timeline",
		"Git Status",
		"Workspace Tree",
	],
};

const TASK_OVERHEAD_CHARS = 4000;
const TIMELINE_CONVERSATION_CHARS = 12000;

function truncateHead(text: string, maxChars: number): string {
	if (maxChars <= 0) return "";
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars)}\n\n[truncated ${text.length - maxChars} chars]`;
}

function truncateTail(text: string, maxChars: number): string {
	if (maxChars <= 0) return "";
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

function normalizeRel(value: string): string {
	return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function dedupe<T>(values: T[]): T[] {
	return [...new Set(values)];
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function globToRegExp(pattern: string): RegExp {
	const normalized = normalizeRel(pattern);
	let source = "^";
	for (let i = 0; i < normalized.length; ) {
		const char = normalized[i];
		if (char === "*" && normalized[i + 1] === "*") {
			if (normalized[i + 2] === "/") {
				source += "(?:.*/)?";
				i += 3;
			} else {
				source += ".*";
				i += 2;
			}
			continue;
		}
		if (char === "*") {
			source += "[^/]*";
			i += 1;
			continue;
		}
		if (char === "?") {
			source += "[^/]";
			i += 1;
			continue;
		}
		source += escapeRegex(char);
		i += 1;
	}
	source += "$";
	return new RegExp(source);
}

function matchesIgnore(relativePath: string, patterns: string[]): boolean {
	const rel = normalizeRel(relativePath);
	const base = path.posix.basename(rel);
	const segments = rel.split("/");

	for (const pattern of patterns) {
		const pat = normalizeRel(pattern);
		if (globToRegExp(pat).test(rel) || globToRegExp(pat).test(base)) return true;
		if (pat.endsWith("/**")) {
			const dir = pat.replace(/^\*\*\//, "").replace(/\/\*\*$/, "");
			if (dir && segments.includes(dir)) return true;
		}
	}
	return false;
}

function isStructuredPath(targetPath: string): boolean {
	return STRUCTURED_EXTENSIONS.has(path.extname(targetPath).toLowerCase());
}

function sectionRank(toolName: string, title: string): number {
	const order = SECTION_PRIORITY[toolName] ?? SECTION_PRIORITY.default;
	const index = order.indexOf(title);
	return index === -1 ? order.length + 1 : index;
}

function formatSections(sections: CapabilityContextSection[]): string {
	return sections
		.filter((section) => section.content.trim().length > 0)
		.map((section) => `## ${section.title}\n${section.content.trim()}`)
		.join("\n\n");
}

function sectionsSize(sections: CapabilityContextSection[]): number {
	let size = 0;
	for (const section of sections) {
		const content = section.content.trim();
		if (!content) continue;
		size += section.title.length + content.length + 5;
	}
	return size;
}

function joinPathBlocks(blocks: PathBlock[]): string {
	return blocks.map((block) => block.content).join("\n\n");
}

function pathDropScore(block: PathBlock): number {
	const kindScore =
		block.kind === "skipped" ? 500 :
		block.kind === "structured" ? 400 :
		block.kind === "directory" ? 300 :
		200;
	const explicitScore = block.explicit ? 0 : 1000;
	return explicitScore + kindScore + Math.min(block.content.length, 100000) / 1000;
}

function setSectionContent(
	sections: CapabilityContextSection[],
	title: string,
	content: string,
): void {
	const index = sections.findIndex((section) => section.title === title);
	if (!content.trim()) {
		if (index >= 0) sections.splice(index, 1);
		return;
	}
	if (index >= 0) {
		sections[index] = { title, content };
		return;
	}
	sections.push({ title, content });
}

function orderedSections(
	toolName: string,
	sections: CapabilityContextSection[],
): CapabilityContextSection[] {
	return [...sections].sort((left, right) => sectionRank(toolName, left.title) - sectionRank(toolName, right.title));
}

/**
 * Reduce context by reverse section priority.
 * - Prefer dropping whole low-priority path blocks before high-priority sections
 * - Prefer truncating Git Diff over deleting it
 * - Never remove Workspace
 */
function enforceContextBudget(
	sections: CapabilityContextSection[],
	pathBlocks: PathBlock[],
	maxContextChars: number,
	toolName: string,
): CapabilityContextSection[] {
	const next = sections.map((section) => ({ ...section }));
	const blocks = [...pathBlocks];

	const syncPathContext = () => {
		setSectionContent(next, "Path Context", joinPathBlocks(blocks));
	};

	syncPathContext();
	if (sectionsSize(next) <= maxContextChars) {
		return orderedSections(toolName, next.filter((section) => section.content.trim()));
	}

	const lowestPriorityTitle = (): string | null => {
		const candidates = next
			.filter((section) => section.title !== "Workspace" && section.content.trim())
			.sort((left, right) => sectionRank(toolName, right.title) - sectionRank(toolName, left.title));
		return candidates[0]?.title ?? null;
	};

	// Bounded iterations: each step either drops a block, truncates, or removes a section.
	for (let step = 0; step < 200 && sectionsSize(next) > maxContextChars; step += 1) {
		const title = lowestPriorityTitle();
		if (!title) break;

		if (title === "Path Context" && blocks.length > 1) {
			blocks.sort((left, right) => pathDropScore(right) - pathDropScore(left));
			blocks.shift();
			syncPathContext();
			continue;
		}

		if (title === "Path Context" && blocks.length === 1) {
			const only = blocks[0];
			const overflow = sectionsSize(next) - maxContextChars;
			const target = Math.max(256, only.content.length - overflow - 64);
			if (target < only.content.length) {
				blocks[0] = {
					...only,
					content: truncateHead(only.content, target),
				};
				syncPathContext();
				continue;
			}
		}

		const section = next.find((item) => item.title === title);
		if (!section) break;

		// Keep a useful prefix for high-signal sections instead of deleting them.
		if (title === "Git Diff" || title === "Path Context" || title === "Recent Conversation") {
			const overflow = sectionsSize(next) - maxContextChars;
			const target = Math.max(256, section.content.length - overflow - 64);
			if (target < section.content.length) {
				setSectionContent(next, title, truncateHead(section.content, target));
				continue;
			}
		}

		setSectionContent(next, title, "");
		if (title === "Path Context") blocks.length = 0;
	}

	// Final hard clamp if still over (should be rare).
	if (sectionsSize(next) > maxContextChars) {
		for (const section of [...next].sort((a, b) => sectionRank(toolName, b.title) - sectionRank(toolName, a.title))) {
			if (section.title === "Workspace") continue;
			if (sectionsSize(next) <= maxContextChars) break;
			const overflow = sectionsSize(next) - maxContextChars;
			const target = Math.max(0, section.content.length - overflow - 64);
			setSectionContent(next, section.title, truncateHead(section.content, target));
		}
	}

	return orderedSections(toolName, next.filter((section) => section.content.trim()));
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

async function collectSerializedConversation(ctx: ExtensionContext, maxChars: number): Promise<string> {
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
	if (paths.length === 0) return "";
	const pathArgs = ["--", ...paths];
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

async function readTextHead(targetPath: string, maxChars: number): Promise<{ text: string; binary: boolean }> {
	const handle = await fs.open(targetPath, "r");
	try {
		const stat = await handle.stat();
		const byteBudget = Math.min(stat.size, Math.max(maxChars * 4, maxChars));
		const buffer = Buffer.alloc(byteBudget);
		const { bytesRead } = await handle.read(buffer, 0, byteBudget, 0);
		const slice = buffer.subarray(0, bytesRead);
		if (slice.includes(0)) return { text: "", binary: true };
		return { text: truncateHead(slice.toString("utf-8"), maxChars), binary: false };
	} finally {
		await handle.close();
	}
}

async function renderPathBlock(
	pi: ExtensionAPI,
	cwd: string,
	targetPath: string,
	explicit: boolean,
	def: CapabilityDef,
	fileBudget: number,
	signal?: AbortSignal,
): Promise<PathBlock> {
	const relative = toWorkspaceRelative(cwd, targetPath);
	const safeBudget = Math.max(0, fileBudget);

	try {
		const stat = await fs.stat(targetPath);
		if (stat.isDirectory()) {
			const listingBudget = Math.min(def.maxTreeChars, safeBudget || def.maxTreeChars);
			try {
				const listing = await runCommand(
					pi,
					"tree",
					["-a", "-L", "2", "--gitignore", targetPath],
					cwd,
					signal,
				);
				return {
					relative,
					explicit,
					kind: "directory",
					content: `## ${relative}\n${truncateHead(listing, listingBudget)}`,
				};
			} catch {
				return {
					relative,
					explicit,
					kind: "directory",
					content: `## ${relative}\n[directory]`,
				};
			}
		}

		const structured = isStructuredPath(targetPath);
		const classBudget = structured ? def.maxStructuredFileChars : def.maxCodeFileChars;
		const budget = Math.min(classBudget, safeBudget || classBudget);
		const { text, binary } = await readTextHead(targetPath, budget);

		if (binary) {
			return {
				relative,
				explicit,
				kind: "skipped",
				content: `## ${relative}\n[binary file skipped]`,
			};
		}

		return {
			relative,
			explicit,
			kind: structured ? "structured" : "code",
			content: `## ${relative}\n\`\`\`\n${numberLines(text)}\n\`\`\``,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : "unable to read";
		return {
			relative,
			explicit,
			kind: "skipped",
			content: `## ${relative}\n[unavailable: ${message}]`,
		};
	}
}

async function collectPathBlocks(
	pi: ExtensionAPI,
	cwd: string,
	autoPaths: string[],
	explicitSet: Set<string>,
	def: CapabilityDef,
	budgetChars: number,
	signal?: AbortSignal,
): Promise<PathBlock[]> {
	if (autoPaths.length === 0 || budgetChars <= 0) return [];

	// Explicit paths first, then auto-changed paths.
	const ordered = [
		...autoPaths.filter((item) => explicitSet.has(item)),
		...autoPaths.filter((item) => !explicitSet.has(item)),
	];

	const blocks: PathBlock[] = [];
	let used = 0;

	for (const targetPath of ordered) {
		if (used >= budgetChars) break;
		const remaining = budgetChars - used;
		// Leave room for separators / headers.
		if (remaining < 128) break;

		const block = await renderPathBlock(
			pi,
			cwd,
			targetPath,
			explicitSet.has(targetPath),
			def,
			remaining,
			signal,
		);

		// Skip empty-ish noise blocks when budget is tight.
		if (!block.explicit && block.kind === "skipped") continue;

		if (block.content.length > remaining) {
			const truncated = {
				...block,
				content: truncateHead(block.content, remaining),
			};
			blocks.push(truncated);
			used += truncated.content.length;
			break;
		}

		blocks.push(block);
		used += block.content.length + 2;
	}

	return blocks;
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
	const explicitSet = new Set(requestedPaths);

	const changedPaths = def.includeChangedFiles
		? (await collectChangedPaths(pi, ctx.cwd, signal)).map((value) => path.resolve(ctx.cwd, value))
		: [];

	const filteredChanged = changedPaths.filter((targetPath) => {
		if (explicitSet.has(targetPath)) return true;
		const relative = toWorkspaceRelative(ctx.cwd, targetPath);
		return !matchesIgnore(relative, def.ignorePaths);
	});

	const autoPaths = dedupe([...requestedPaths, ...filteredChanged]).slice(0, def.maxFiles);
	const relativeAutoPaths = autoPaths.map((item) => toWorkspaceRelative(ctx.cwd, item));

	const promptBudget = Math.max(4000, def.maxContextChars - TASK_OVERHEAD_CHARS);
	const sections: CapabilityContextSection[] = [
		{
			title: "Workspace",
			content: [
				`cwd: ${ctx.cwd}`,
				relativeAutoPaths.length > 0 ? `selected paths: ${relativeAutoPaths.join(", ")}` : "",
			].filter(Boolean).join("\n"),
		},
	];

	const wantsTimeline = (input.includeTimeline ?? def.includeTimeline) === true;
	const wantsConversation = (input.includeConversation ?? def.includeConversation) === true;
	const conversation = wantsTimeline || wantsConversation
		? await collectSerializedConversation(ctx, def.maxConversationChars)
		: "";

	// Timeline is a nested model call — keep its input small so assembly can't stall.
	if (wantsTimeline) {
		const timelineConversation = truncateTail(conversation, TIMELINE_CONVERSATION_CHARS);
		const timeline = await collectActionTimeline(ctx, def, input.task, timelineConversation, signal);
		if (timeline) sections.push({ title: "Action Timeline", content: timeline });
	}

	if (wantsConversation && conversation) {
		sections.push({ title: "Recent Conversation", content: conversation });
	}

	if (def.includeGitStatus) {
		const gitStatus = await collectGitStatus(pi, ctx.cwd, signal);
		if (gitStatus) sections.push({ title: "Git Status", content: gitStatus });
	}

	if ((input.includeTree ?? def.includeTree) === true) {
		const tree = await collectTree(pi, ctx.cwd, def.maxTreeChars, signal);
		if (tree) sections.push({ title: "Workspace Tree", content: tree });
	}

	const fixedSize = sectionsSize(sections);
	let remaining = Math.max(0, promptBudget - fixedSize);

	// Capability-shaped fill order for the remaining budget.
	let pathBlocks: PathBlock[] = [];
	const wantsDiff = (input.includeDiff ?? def.includeGitDiff) === true && relativeAutoPaths.length > 0;

	const fillDiff = async (budget: number) => {
		if (!wantsDiff || budget <= 0) return;
		const diff = await collectGitDiff(pi, ctx.cwd, relativeAutoPaths, budget, signal);
		if (diff) {
			sections.push({ title: "Git Diff", content: diff });
			remaining = Math.max(0, promptBudget - sectionsSize(sections));
		}
	};

	const fillPaths = async (budget: number) => {
		if (budget <= 0 || autoPaths.length === 0) return;
		pathBlocks = await collectPathBlocks(pi, ctx.cwd, autoPaths, explicitSet, def, budget, signal);
		if (pathBlocks.length > 0) {
			sections.push({ title: "Path Context", content: joinPathBlocks(pathBlocks) });
			remaining = Math.max(0, promptBudget - sectionsSize(sections));
		}
	};

	if (def.toolName === "patch_reviewer") {
		// Diff is the primary evidence; files fill whatever is left.
		await fillDiff(Math.floor(remaining * 0.7));
		await fillPaths(remaining);
	} else if (def.toolName === "reasoning_coach") {
		// Conversation already included; code is optional backup.
		await fillPaths(remaining);
		await fillDiff(remaining);
	} else {
		// code_scout and default: files first, then optional diff.
		await fillPaths(remaining);
		await fillDiff(remaining);
	}

	const budgeted = enforceContextBudget(sections, pathBlocks, promptBudget, def.toolName);

	return {
		sections: budgeted,
		autoPaths: relativeAutoPaths,
	};
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
