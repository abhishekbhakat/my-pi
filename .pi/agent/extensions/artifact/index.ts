/**
 * Artifact extension
 *
 * Pin assistant replies to the project so they survive compact and session switches.
 *
 * Storage: <cwd>/.agents/artifacts/NNN-slug.md
 * Commands:
 *   /artifact [name]          save last assistant message
 *   /artifacts [number|name]  list all, or show one
 * Tool:
 *   artifact { action: list|get, number?, name? }
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ARTIFACTS_DIR = ".agents/artifacts";
const FILENAME_RE = /^(\d+)-(.+)\.md$/i;

interface ArtifactMeta {
	number: number;
	name: string;
	slug: string;
	createdAt: string;
	sessionId?: string;
	sessionName?: string;
	sessionFile?: string;
	sourceEntryId?: string;
	path: string;
	filename: string;
}

interface Artifact extends ArtifactMeta {
	body: string;
}

function artifactsDir(cwd: string): string {
	return join(cwd, ARTIFACTS_DIR);
}

function padNumber(n: number): string {
	return n < 1000 ? String(n).padStart(3, "0") : String(n);
}

function slugify(raw: string): string {
	const slug = raw
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/-{2,}/g, "-")
		.slice(0, 48)
		.replace(/-+$/g, "");
	return slug || "untitled";
}

function autoNameFromBody(body: string): string {
	const lines = body.split(/\r?\n/);
	for (const line of lines) {
		const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
		if (heading?.[1]) return heading[1].trim();
	}
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		if (trimmed === "---") continue;
		return trimmed.length > 60 ? `${trimmed.slice(0, 57)}...` : trimmed;
	}
	return "untitled";
}

function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		if (!block || typeof block !== "object") continue;
		const b = block as { type?: string; text?: string };
		if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
			parts.push(b.text);
		}
	}
	return parts.join("\n\n").trim();
}

function lastAssistant(
	ctx: ExtensionContext
): { text: string; entryId: string } | null {
	const branch = ctx.sessionManager.getBranch();
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry.type !== "message") continue;
		const msg = entry.message;
		if (!("role" in msg) || msg.role !== "assistant") continue;
		const text = extractText(msg.content);
		if (!text) continue;
		return { text, entryId: entry.id };
	}
	return null;
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
	if (!raw.startsWith("---\n") && !raw.startsWith("---\r\n")) {
		return { meta: {}, body: raw };
	}
	const end = raw.indexOf("\n---", 4);
	if (end === -1) return { meta: {}, body: raw };
	const fm = raw.slice(4, end).trim();
	let body = raw.slice(end + 4);
	if (body.startsWith("\r\n")) body = body.slice(2);
	else if (body.startsWith("\n")) body = body.slice(1);

	const meta: Record<string, string> = {};
	for (const line of fm.split(/\r?\n/)) {
		const m = line.match(/^([A-Za-z][A-Za-z0-9_]*)\s*:\s*(.*)$/);
		if (!m) continue;
		meta[m[1]] = m[2].trim();
	}
	return { meta, body };
}

function serializeArtifact(meta: Omit<ArtifactMeta, "path" | "filename">, body: string): string {
	const lines = [
		"---",
		`number: ${meta.number}`,
		`name: ${meta.name}`,
		`slug: ${meta.slug}`,
		`createdAt: ${meta.createdAt}`,
	];
	if (meta.sessionId) lines.push(`sessionId: ${meta.sessionId}`);
	if (meta.sessionName) lines.push(`sessionName: ${meta.sessionName}`);
	if (meta.sessionFile) lines.push(`sessionFile: ${meta.sessionFile}`);
	if (meta.sourceEntryId) lines.push(`sourceEntryId: ${meta.sourceEntryId}`);
	lines.push("---", "", body.trimEnd(), "");
	return lines.join("\n");
}

async function ensureDir(cwd: string): Promise<string> {
	const dir = artifactsDir(cwd);
	await mkdir(dir, { recursive: true });
	return dir;
}

async function listArtifacts(cwd: string): Promise<ArtifactMeta[]> {
	const dir = artifactsDir(cwd);
	let names: string[];
	try {
		names = await readdir(dir);
	} catch {
		return [];
	}

	const out: ArtifactMeta[] = [];
	for (const filename of names) {
		const m = filename.match(FILENAME_RE);
		if (!m) continue;
		const number = Number.parseInt(m[1], 10);
		if (!Number.isFinite(number)) continue;
		const path = join(dir, filename);
		let name = m[2];
		let slug = m[2];
		let createdAt = "";
		let sessionId: string | undefined;
		let sessionName: string | undefined;
		let sessionFile: string | undefined;
		let sourceEntryId: string | undefined;
		try {
			const raw = await readFile(path, "utf8");
			const { meta } = parseFrontmatter(raw);
			if (meta.name) name = meta.name;
			if (meta.slug) slug = meta.slug;
			if (meta.createdAt) createdAt = meta.createdAt;
			if (meta.sessionId) sessionId = meta.sessionId;
			if (meta.sessionName) sessionName = meta.sessionName;
			if (meta.sessionFile) sessionFile = meta.sessionFile;
			if (meta.sourceEntryId) sourceEntryId = meta.sourceEntryId;
		} catch {
			// keep filename-derived fields
		}
		out.push({
			number,
			name,
			slug,
			createdAt,
			sessionId,
			sessionName,
			sessionFile,
			sourceEntryId,
			path,
			filename,
		});
	}

	out.sort((a, b) => a.number - b.number);
	return out;
}

async function nextNumber(cwd: string): Promise<number> {
	const items = await listArtifacts(cwd);
	if (items.length === 0) return 1;
	return Math.max(...items.map((a) => a.number)) + 1;
}

async function readArtifact(meta: ArtifactMeta): Promise<Artifact> {
	const raw = await readFile(meta.path, "utf8");
	const { meta: fm, body } = parseFrontmatter(raw);
	return {
		...meta,
		name: fm.name || meta.name,
		slug: fm.slug || meta.slug,
		createdAt: fm.createdAt || meta.createdAt,
		sessionId: fm.sessionId || meta.sessionId,
		sessionName: fm.sessionName || meta.sessionName,
		sessionFile: fm.sessionFile || meta.sessionFile,
		sourceEntryId: fm.sourceEntryId || meta.sourceEntryId,
		body: body.trimEnd(),
	};
}

function findArtifact(
	items: ArtifactMeta[],
	opts: { number?: number; name?: string }
): ArtifactMeta | undefined {
	if (opts.number !== undefined) {
		return items.find((a) => a.number === opts.number);
	}
	if (opts.name) {
		const q = opts.name.trim().toLowerCase();
		const asNum = Number.parseInt(q, 10);
		if (/^\d+$/.test(q) && Number.isFinite(asNum)) {
			const byNum = items.find((a) => a.number === asNum);
			if (byNum) return byNum;
		}
		return items.find(
			(a) =>
				a.slug.toLowerCase() === q ||
				a.name.toLowerCase() === q ||
				a.filename.toLowerCase() === q ||
				a.filename.toLowerCase() === `${q}.md`
		);
	}
	return undefined;
}

function preview(text: string, max = 80): string {
	const one = text.replace(/\s+/g, " ").trim();
	if (one.length <= max) return one;
	return `${one.slice(0, max - 1)}…`;
}

function formatList(items: ArtifactMeta[], bodies?: Map<number, string>): string {
	if (items.length === 0) {
		return `No artifacts in ${ARTIFACTS_DIR}/`;
	}
	const lines = items.map((a) => {
		const label = `#${a.number} ${a.name}`;
		const when = a.createdAt ? ` (${a.createdAt.slice(0, 19).replace("T", " ")})` : "";
		const session = a.sessionId ? ` [session ${shortSessionId(a.sessionId)}${a.sessionName ? ` ${a.sessionName}` : ""}]` : "";
		const body = bodies?.get(a.number);
		const tail = body ? ` — ${preview(body)}` : "";
		return `${label}${when}${session}${tail}`;
	});
	return [`Artifacts in ${ARTIFACTS_DIR}/ (${items.length}):`, ...lines].join("\n");
}

function shortSessionId(id: string): string {
	return id.length > 12 ? id.slice(0, 8) : id;
}

function sessionMetaFromCtx(ctx: ExtensionContext): {
	sessionId?: string;
	sessionName?: string;
	sessionFile?: string;
} {
	const sm = ctx.sessionManager;
	const sessionId = sm.getSessionId?.() || undefined;
	const sessionName = sm.getSessionName?.() || undefined;
	const sessionFile = sm.getSessionFile?.() || undefined;
	return {
		sessionId: sessionId || undefined,
		sessionName: sessionName || undefined,
		sessionFile: sessionFile || undefined,
	};
}

async function saveArtifact(
	ctx: ExtensionContext,
	nameArg: string
): Promise<{ ok: true; artifact: ArtifactMeta } | { ok: false; error: string }> {
	const last = lastAssistant(ctx);
	if (!last) return { ok: false, error: "No assistant message to save" };

	const dir = await ensureDir(ctx.cwd);
	const number = await nextNumber(ctx.cwd);
	const name = nameArg.trim() || autoNameFromBody(last.text);
	const slug = slugify(name);
	const createdAt = new Date().toISOString();
	const filename = `${padNumber(number)}-${slug}.md`;
	const path = join(dir, filename);
	const session = sessionMetaFromCtx(ctx);

	const meta: Omit<ArtifactMeta, "path" | "filename"> = {
		number,
		name,
		slug,
		createdAt,
		...session,
		sourceEntryId: last.entryId,
	};
	const file = serializeArtifact(meta, last.text);
	await writeFile(path, file, "utf8");

	return {
		ok: true,
		artifact: { ...meta, path, filename },
	};
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("artifact", {
		description: "Save last assistant reply as project artifact (/artifact [name])",
		handler: async (args, ctx) => {
			const result = await saveArtifact(ctx, args);
			if (!result.ok) {
				ctx.ui.notify(result.error, "warning");
				return;
			}
			const a = result.artifact;
			const sessionBit = a.sessionId
				? ` (session ${shortSessionId(a.sessionId)}${a.sessionName ? ` ${a.sessionName}` : ""})`
				: "";
			ctx.ui.notify(
				`Saved artifact #${a.number} → ${ARTIFACTS_DIR}/${a.filename}${sessionBit}`,
				"info"
			);
		},
	});

	pi.registerCommand("artifacts", {
		description: "List project artifacts, or show one (/artifacts [number|name])",
		handler: async (args, ctx) => {
			const items = await listArtifacts(ctx.cwd);
			const q = args.trim();
			if (!q) {
				const bodies = new Map<number, string>();
				// previews for short lists only
				if (items.length <= 30) {
					for (const item of items) {
						try {
							const full = await readArtifact(item);
							bodies.set(item.number, full.body);
						} catch {
							// skip preview
						}
					}
				}
				ctx.ui.notify(formatList(items, bodies), "info");
				return;
			}

			const hit = findArtifact(items, { name: q });
			if (!hit) {
				ctx.ui.notify(`No artifact matching "${q}"`, "warning");
				return;
			}
			try {
				const full = await readArtifact(hit);
				const sessionBit = full.sessionId
					? `\nsession: ${full.sessionId}${full.sessionName ? ` (${full.sessionName})` : ""}`
					: "";
				const fileBit = full.sessionFile ? `\nsessionFile: ${full.sessionFile}` : "";
				const header = `#${full.number} ${full.name}  (${full.filename})${sessionBit}${fileBit}`;
				ctx.ui.notify(`${header}\n\n${full.body}`, "info");
			} catch (err) {
				ctx.ui.notify(`Failed to read ${hit.filename}: ${err}`, "error");
			}
		},
	});

	pi.registerTool({
		name: "artifact",
		label: "Artifact",
		description:
			"List or read project artifacts saved under .agents/artifacts/. " +
			"Use after compact or across sessions when the user points at an artifact by number (e.g. artifact 74).",
		promptSnippet:
			"Read pinned project artifacts (.agents/artifacts/). Prefer get by number when user says artifact N.",
		promptGuidelines: [
			"Artifacts hold full native text that may be missing from compacted chat history.",
			"Call artifact list before guessing names. Call artifact get with number when user cites one.",
			"Do not recreate an artifact that already exists; read it instead.",
		],
		parameters: Type.Object({
			action: Type.Union([Type.Literal("list"), Type.Literal("get")], {
				description: "list: catalog with previews; get: full body by number or name",
			}),
			number: Type.Optional(
				Type.Number({ description: "Artifact number (e.g. 74). Preferred for get." })
			),
			name: Type.Optional(
				Type.String({ description: "Artifact name or slug (fallback for get)" })
			),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const items = await listArtifacts(ctx.cwd);

			if (params.action === "list") {
				if (items.length === 0) {
					return {
						content: [{ type: "text", text: `No artifacts in ${ARTIFACTS_DIR}/` }],
						details: { count: 0, dir: artifactsDir(ctx.cwd) },
					};
				}
				const lines: string[] = [
					`Artifacts in ${ARTIFACTS_DIR}/ (${items.length}):`,
					"",
				];
				for (const item of items) {
					let prev = "";
					try {
						const full = await readArtifact(item);
						prev = preview(full.body, 100);
					} catch {
						prev = "(unreadable)";
					}
					const when = item.createdAt
						? item.createdAt.slice(0, 19).replace("T", " ")
						: "unknown time";
					lines.push(`#${item.number}  ${item.name}`);
					lines.push(`    file: ${item.filename}`);
					lines.push(`    at:   ${when}`);
					if (item.sessionId) {
						const nameBit = item.sessionName ? ` (${item.sessionName})` : "";
						lines.push(`    session: ${item.sessionId}${nameBit}`);
					}
					lines.push(`    preview: ${prev}`);
					lines.push("");
				}
				return {
					content: [{ type: "text", text: lines.join("\n").trimEnd() }],
					details: {
						count: items.length,
						numbers: items.map((a) => a.number),
						dir: artifactsDir(ctx.cwd),
					},
				};
			}

			// get
			if (params.number === undefined && !params.name?.trim()) {
				return {
					content: [
						{
							type: "text",
							text: "get requires number or name. Example: { action: \"get\", number: 74 }",
						},
					],
					details: { error: "missing_selector" },
				};
			}

			const hit = findArtifact(items, {
				number: params.number,
				name: params.name,
			});
			if (!hit) {
				const hint =
					items.length === 0
						? "No artifacts saved yet."
						: `Known numbers: ${items.map((a) => a.number).join(", ")}`;
				return {
					content: [
						{
							type: "text",
							text: `Artifact not found (${params.number ?? params.name}). ${hint}`,
						},
					],
					details: { error: "not_found" },
				};
			}

			try {
				const full = await readArtifact(hit);
				const header = [
					`# Artifact #${full.number}: ${full.name}`,
					`file: ${ARTIFACTS_DIR}/${full.filename}`,
					full.createdAt ? `createdAt: ${full.createdAt}` : null,
					full.sessionId ? `sessionId: ${full.sessionId}` : null,
					full.sessionName ? `sessionName: ${full.sessionName}` : null,
					full.sessionFile ? `sessionFile: ${full.sessionFile}` : null,
					full.sourceEntryId ? `sourceEntryId: ${full.sourceEntryId}` : null,
					"",
					full.body,
				]
					.filter((line) => line !== null)
					.join("\n");
				return {
					content: [{ type: "text", text: header }],
					details: {
						number: full.number,
						name: full.name,
						filename: full.filename,
						path: full.path,
						sessionId: full.sessionId,
						sessionName: full.sessionName,
						sessionFile: full.sessionFile,
						bytes: full.body.length,
					},
				};
			} catch (err) {
				return {
					content: [{ type: "text", text: `Failed to read artifact: ${err}` }],
					details: { error: "read_failed" },
				};
			}
		},
	});
}
