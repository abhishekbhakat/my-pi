import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { CapabilityDef } from "./types";

export const DEFAULT_IGNORE_PATHS = [
	"**/*.lock",
	"**/package-lock.json",
	"**/yarn.lock",
	"**/pnpm-lock.yaml",
	"**/Cargo.lock",
	"**/poetry.lock",
	"**/composer.lock",
	"**/*.min.js",
	"**/*.map",
	"**/dist/**",
	"**/build/**",
	"**/node_modules/**",
	"**/vendor/**",
];

const DEFAULTS = {
	includeConversation: true,
	includeTree: false,
	includeGitStatus: true,
	includeGitDiff: false,
	includeChangedFiles: true,
	includeTimeline: false,
	timelineModel: "anthropic-proxy/Kimi-for-Coding",
	maxContextChars: 360000,
	maxConversationChars: 40000,
	maxTreeChars: 12000,
	maxTimelineChars: 8000,
	maxFiles: 24,
	maxCodeFileChars: 120000,
	maxStructuredFileChars: 20000,
	ignorePaths: DEFAULT_IGNORE_PATHS,
	reasoningEffort: "high",
};

const extensionDir = path.dirname(fileURLToPath(import.meta.url));
const capabilitiesDir = path.join(extensionDir, "capabilities");

function normalizeToolName(value: string): string {
	return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function parseScalar(value: string): string | boolean | number {
	const trimmed = value.trim();
	if (trimmed === "true") return true;
	if (trimmed === "false") return false;
	if (/^-?\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
	return trimmed;
}

function asBool(value: string | boolean | number | undefined, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function asNumber(value: string | boolean | number | undefined, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asString(value: string | boolean | number | undefined, fallback = ""): string {
	return typeof value === "string" ? value : fallback;
}

function asList(value: string | boolean | number | undefined): string[] {
	return typeof value === "string"
		? value.split("|").map((item) => item.trim()).filter(Boolean)
		: [];
}

function dedupe(values: string[]): string[] {
	return [...new Set(values)];
}

export function parseCapabilityFile(filePath: string): CapabilityDef | null {
	try {
		const raw = fs.readFileSync(filePath, "utf-8").replace(/\r\n/g, "\n");
		const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
		if (!match) return null;

		const frontmatter: Record<string, string | boolean | number> = {};
		for (const line of match[1].split("\n")) {
			const index = line.indexOf(":");
			if (index <= 0) continue;
			const key = line.slice(0, index).trim();
			const value = line.slice(index + 1);
			frontmatter[key] = parseScalar(value);
		}

		const name = asString(frontmatter.name);
		const description = asString(frontmatter.description);
		const model = asString(frontmatter.model);
		if (!name || !description || !model) return null;

		const toolName = normalizeToolName(asString(frontmatter.tool, name));
		const label = asString(frontmatter.label, name);
		const extraIgnore = asList(frontmatter.ignorePaths);

		// Legacy maxFileChars maps to code budget if maxCodeFileChars is absent.
		const maxCodeFileChars = asNumber(
			frontmatter.maxCodeFileChars,
			asNumber(frontmatter.maxFileChars, DEFAULTS.maxCodeFileChars),
		);

		return {
			name,
			toolName,
			label,
			description,
			model,
			systemPrompt: match[2].trim(),
			file: filePath,
			promptSnippet: asString(frontmatter.promptSnippet) || undefined,
			promptGuidelines: asList(frontmatter.promptGuidelines),
			includeConversation: asBool(frontmatter.includeConversation, DEFAULTS.includeConversation),
			includeTree: asBool(frontmatter.includeTree, DEFAULTS.includeTree),
			includeGitStatus: asBool(frontmatter.includeGitStatus, DEFAULTS.includeGitStatus),
			includeGitDiff: asBool(frontmatter.includeGitDiff, DEFAULTS.includeGitDiff),
			includeChangedFiles: asBool(frontmatter.includeChangedFiles, DEFAULTS.includeChangedFiles),
			includeTimeline: asBool(frontmatter.includeTimeline, DEFAULTS.includeTimeline),
			timelineModel: asString(frontmatter.timelineModel, DEFAULTS.timelineModel),
			maxContextChars: asNumber(frontmatter.maxContextChars, DEFAULTS.maxContextChars),
			maxConversationChars: asNumber(frontmatter.maxConversationChars, DEFAULTS.maxConversationChars),
			maxTreeChars: asNumber(frontmatter.maxTreeChars, DEFAULTS.maxTreeChars),
			maxTimelineChars: asNumber(frontmatter.maxTimelineChars, DEFAULTS.maxTimelineChars),
			maxFiles: asNumber(frontmatter.maxFiles, DEFAULTS.maxFiles),
			maxCodeFileChars,
			maxStructuredFileChars: asNumber(frontmatter.maxStructuredFileChars, DEFAULTS.maxStructuredFileChars),
			ignorePaths: dedupe([...DEFAULTS.ignorePaths, ...extraIgnore]),
			reasoningEffort: asString(frontmatter.reasoningEffort, DEFAULTS.reasoningEffort),
		};
	} catch {
		return null;
	}
}

export function loadCapabilityDefs(): CapabilityDef[] {
	if (!fs.existsSync(capabilitiesDir)) return [];

	return fs.readdirSync(capabilitiesDir)
		.filter((file) => file.endsWith(".md"))
		.map((file) => parseCapabilityFile(path.join(capabilitiesDir, file)))
		.filter((def): def is CapabilityDef => def !== null)
		.sort((left, right) => left.toolName.localeCompare(right.toolName));
}
