import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { buildSessionProjection, CURRENT_SESSION_VERSION, type ExtensionAPI, type ExtensionContext, type SessionEntry } from "@earendil-works/pi-coding-agent";

export interface CapabilitySkill { name: string; filePath: string }

export function resolveCapabilitySkills(pi: Pick<ExtensionAPI, "getCommands">, names?: unknown): CapabilitySkill[] {
	if (names === undefined) return [];
	if (!Array.isArray(names) || names.some(name => typeof name !== "string" || !name)) {
		throw new Error("Skills must be an array of skill names.");
	}
	if (!names.length) return [];
	const skills = new Map(pi.getCommands().filter(command => command.source === "skill")
		.map(command => [command.name, command.sourceInfo.path]));
	return [...new Set(names)].map(name => {
		const filePath = skills.get(`skill:${name}`);
		if (!filePath) throw new Error(`Unknown skill ${JSON.stringify(name)}. Use a skill name discovered by the parent session.`);
		if (!isAbsolute(filePath) || !statSync(filePath, { throwIfNoEntry: false })?.isFile()) {
			throw new Error(`Skill ${JSON.stringify(name)} has no readable skill file.`);
		}
		return { name, filePath };
	});
}

export async function withCapabilitySkills(systemPrompt: string, skills: readonly CapabilitySkill[]): Promise<string> {
	if (!skills.length) return systemPrompt;
	const instructions = await Promise.all(skills.map(async ({ name, filePath }) => {
		const text = await readFile(filePath, "utf8");
		return `### ${name}\n${text.trim()}`;
	}));
	return `${systemPrompt}\n\n## Selected skills\n${instructions.join("\n\n")}`;
}

// Match Pi's rendered catalog, including the associated guidance when present.
const SKILL_CATALOG = /^(?:The following skills provide specialized instructions for specific tasks\.\r?\n[^\r\n]*\r?\nResolve relative paths against the skill's directory[^\r\n]*\r?\n\r?\n)?<available_skills>\r?\n[\s\S]*?^<\/available_skills>[ \t]*(?:\r?\n|$)/gm;

export function stripSkillCatalog(prompt: string): string {
	if (!prompt.includes("<available_skills>")) return prompt;
	return prompt.replace(SKILL_CATALOG, "").replace(/^<skills>\r?\n\s*?<\/skills>[ \t]*(?:\r?\n|$)/gm, "");
}

/** Capture the active branch now, not after the background task starts. */
export function snapshotContext(ctx: ExtensionContext): ExtensionContext {
	const branch = structuredClone(ctx.sessionManager.getBranch());
	const entries = structuredClone(ctx.sessionManager.getEntries());
	const sessionId = ctx.sessionManager.getSessionId();
	const prompt = ctx.getSystemPrompt();
	const manager = new Proxy(ctx.sessionManager, {
		get(target, key) {
			if (key === "getBranch") return () => structuredClone(branch);
			if (key === "getEntries") return () => structuredClone(entries);
			if (key === "getSessionId") return () => sessionId;
			const value = Reflect.get(target, key);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
	return { ...ctx, cwd: ctx.cwd, sessionManager: manager, getSystemPrompt: () => prompt };
}

export interface TranscriptRepair { action: "drop-output" | "close-call"; entryId: string; toolCallId: string }
const BOUNDARY_TEXT = "Branch snapshot boundary: this parent tool call is pending. No result is available in this child branch.";

/** Use Pi's canonical projection, including firstKeptEntryId and context edits. */
export function repairCoderTranscript(branch: readonly SessionEntry[], strict = false) {
	const entries = structuredClone([...branch]);
	const projection = buildSessionProjection(entries);
	const drops = new Set<string>();
	const inserts = new Map<string, SessionEntry[]>();
	const repairs: TranscriptRepair[] = [];
	const pending = new Map<string, { name: string; source: SessionEntry }>();
	const ids = new Set(entries.map(entry => entry.id));
	const closeCalls = () => {
		for (const [toolCallId, { name, source }] of pending) {
			let id = `boundary-${source.id}-${repairs.length}`;
			while (ids.has(id)) id += "x";
			ids.add(id);
			const result: SessionEntry = { type: "message", id, parentId: source.id, timestamp: source.timestamp, message: {
				role: "toolResult", toolCallId, toolName: name, isError: false,
				timestamp: Date.parse(source.timestamp) || 0, content: [{ type: "text", text: BOUNDARY_TEXT }],
			} };
			inserts.set(source.id, [...(inserts.get(source.id) ?? []), result]);
			repairs.push({ action: "close-call", entryId: source.id, toolCallId });
		}
		pending.clear();
	};
	for (const { sourceEntry, messages } of projection.entries) {
		for (const message of messages) {
			if (message.role === "assistant" || message.role === "user") closeCalls();
			if (message.role === "assistant" && message.stopReason !== "error" && message.stopReason !== "aborted") {
				for (const part of message.content) if (part.type === "toolCall") pending.set(part.id, { name: part.name, source: sourceEntry });
			} else if (message.role === "toolResult") {
				if (pending.has(message.toolCallId)) pending.delete(message.toolCallId);
				else {
					drops.add(sourceEntry.id);
					repairs.push({ action: "drop-output", entryId: sourceEntry.id, toolCallId: message.toolCallId });
				}
			}
		}
	}
	closeCalls();
	const removed = (entry: SessionEntry) => drops.has(entry.id) || (entry.type === "context_edit" && drops.has(entry.targetId));
	const fixed = entries.flatMap(entry => removed(entry) ? [] : [entry, ...(inserts.get(entry.id) ?? [])]);
	// Keep compaction anchors valid when their first retained output was dropped.
	for (const entry of fixed) {
		if (entry.type !== "compaction" || !drops.has(entry.firstKeptEntryId)) continue;
		const start = entries.findIndex(item => item.id === entry.firstKeptEntryId);
		const end = entries.findIndex(item => item.id === entry.id);
		entry.firstKeptEntryId = entries.slice(start + 1, end).find(item => !removed(item))?.id ?? entry.id;
	}
	let parentId: string | null = null;
	for (const entry of fixed) { entry.parentId = parentId; parentId = entry.id; }
	if (strict && repairCoderTranscript(fixed).repairCount !== 0) throw new Error("[transcript] Snapshot repair left invalid tool pairs.");
	return { entries: fixed, repairs, repairCount: repairs.length };
}

/** Keep the branch history, excluding inherited skill catalogs from prompt records. */
export function coderSession(branch: readonly SessionEntry[], cwd: string): string {
	const timestamp = new Date().toISOString();
	const repaired = repairCoderTranscript(branch, true);
	for (const entry of repaired.entries) {
		const message = entry.type === "message" && entry.message.role === "system" ? entry.message
			: entry.type === "compaction" ? entry.systemMessage : undefined;
		if (!message) continue;
		message.content = typeof message.content === "string" ? stripSkillCatalog(message.content)
			: message.content.map(block => ({ ...block, text: stripSkillCatalog(block.text) }));
		for (const [key, section] of Object.entries(message.sections ?? {})) {
			if (!section) continue;
			const filtered = stripSkillCatalog(section);
			if (filtered !== section && message.sections) message.sections[key] = filtered.trim() ? filtered : null;
		}
	}
	const audit: SessionEntry = {
		type: "custom", id: randomUUID(), parentId: repaired.entries.at(-1)?.id ?? null,
		timestamp, customType: "coder-transcript-repairs", data: { repairCount: repaired.repairCount, repairs: repaired.repairs },
	};
	return [{ type: "session", version: CURRENT_SESSION_VERSION, id: randomUUID(), timestamp, cwd },
		...repaired.entries, audit].map(row => JSON.stringify(row)).join("\n") + "\n";
}
