import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { CapabilityDef } from "./types";

const DEFAULTS = {
	includeConversation: true,
	includeTree: false,
	includeGitStatus: true,
	includeGitDiff: false,
	includeChangedFiles: true,
	maxConversationChars: 12000,
	maxTreeChars: 5000,
	maxGitDiffChars: 9000,
	maxFiles: 4,
	maxFileChars: 4000,
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
			maxConversationChars: asNumber(frontmatter.maxConversationChars, DEFAULTS.maxConversationChars),
			maxTreeChars: asNumber(frontmatter.maxTreeChars, DEFAULTS.maxTreeChars),
			maxGitDiffChars: asNumber(frontmatter.maxGitDiffChars, DEFAULTS.maxGitDiffChars),
			maxFiles: asNumber(frontmatter.maxFiles, DEFAULTS.maxFiles),
			maxFileChars: asNumber(frontmatter.maxFileChars, DEFAULTS.maxFileChars),
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
