import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const CODE_EXTENSIONS = new Set([
	".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
	".py", ".go", ".rs", ".java", ".kt", ".rb", ".php", ".cs",
	".swift", ".c", ".h", ".cc", ".cpp", ".hpp", ".sh", ".sql",
]);

const DOC_EXTENSIONS = new Set([".md", ".mdx", ".rst", ".txt", ".adoc"]);

const EXCLUDE_DIR_NAMES = new Set([
	"node_modules", "dist", "build", ".venv", "venv", "__pycache__",
	"vendor", ".next", "coverage", ".git", ".hg", ".svn", ".tox",
	".mypy_cache", ".pytest_cache", ".ruff_cache", "target",
]);

const STOPWORDS = new Set([
	"map", "find", "where", "live", "today", "path", "flow", "code", "the",
	"and", "with", "from", "into", "what", "which", "how", "does", "this",
	"that", "them", "then", "than", "when", "have", "need", "also", "only",
	"over", "after", "before", "about", "under", "between", "across", "for",
	"are", "was", "were", "been", "being", "will", "would", "could", "should",
	"must", "just", "like", "into", "onto", "your", "our", "their", "its",
	"file", "files", "dirs", "directory", "module", "modules", "please",
	"show", "list", "look", "trace", "check", "read", "open", "edit",
]);

const ENTRY_BASENAMES = new Set([
	"index", "main", "__init__", "router", "routes", "service", "handler",
	"handlers", "api", "app", "webhook", "worker", "batch", "queue",
]);

export interface ExpandedFile {
	abs: string;
	rel: string;
	score: number;
	matched: string[];
}

export interface ExpandOptions {
	task: string;
	perDir: number;
	timeoutMs: number;
	signal?: AbortSignal;
}

export function extractKeywords(task: string, max = 16): string[] {
	const raw = task.match(/[A-Za-z][A-Za-z0-9_]*/g) ?? [];
	const out: string[] = [];
	const seen = new Set<string>();

	const push = (token: string) => {
		const lower = token.toLowerCase();
		if (seen.has(lower)) return false;
		if (STOPWORDS.has(lower)) return false;
		const keepShort = token.length === 3 && /[A-Z]/.test(token);
		if (token.length < 4 && !keepShort) return false;
		seen.add(lower);
		out.push(lower);
		return true;
	};

	// Prefer snake_case / CamelCase identifiers first so caps don't drop them.
	const prioritized = [
		...raw.filter((token) => token.includes("_") || /[a-z][A-Z]/.test(token)),
		...raw.filter((token) => !token.includes("_") && !/[a-z][A-Z]/.test(token)),
	];

	for (const token of prioritized) {
		push(token);
		if (token.includes("_")) {
			for (const part of token.split("_")) push(part);
		} else {
			const camelParts = token.split(/(?=[A-Z])/).filter(Boolean);
			if (camelParts.length > 1) {
				for (const part of camelParts) push(part);
			}
		}
		if (out.length >= max) break;
	}
	return out.slice(0, max);
}

function extensionOf(rel: string): string {
	return path.extname(rel).toLowerCase();
}

function isCodePath(rel: string): boolean {
	return CODE_EXTENSIONS.has(extensionOf(rel));
}

function isDocPath(rel: string): boolean {
	return DOC_EXTENSIONS.has(extensionOf(rel));
}

export function scoreCandidate(
	rel: string,
	matched: ReadonlySet<string>,
	hits: number,
	keywords: string[],
	taskMentionsTests: boolean,
): number {
	let score = matched.size * 10 + Math.min(hits, 50) / 5;
	const lower = rel.toLowerCase();
	const base = path.basename(lower, path.extname(lower));

	for (const kw of keywords) {
		if (lower.includes(kw) || base.includes(kw)) score += 8;
	}
	if (ENTRY_BASENAMES.has(base)) score += 3;
	if (!taskMentionsTests && /(^|\/)(tests?|spec)(\/|$)|_test\.|\.test\.|\.spec\./i.test(rel)) {
		score -= 6;
	}
	if (isDocPath(rel)) score -= 4;
	score -= Math.max(0, rel.split("/").length - 2) * 0.5;
	return score;
}

async function listViaGit(
	pi: ExtensionAPI,
	cwd: string,
	dir: string,
	signal?: AbortSignal,
): Promise<string[]> {
	try {
		const result = await pi.exec(
			"git",
			["ls-files", "-co", "--exclude-standard", "--", dir],
			{ cwd, signal, timeout: 8000 },
		);
		if (result.code !== 0) return [];
		return result.stdout
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);
	} catch {
		return [];
	}
}

async function listViaWalk(dirAbs: string, cwd: string): Promise<string[]> {
	const out: string[] = [];
	const root = path.resolve(dirAbs);

	const walk = async (current: string, depth: number): Promise<void> => {
		if (out.length >= 4000 || depth > 6) return;
		let entries;
		try {
			entries = await fs.readdir(current, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (out.length >= 4000) return;
			if (entry.name.startsWith(".") && entry.name !== ".env.example") continue;
			if (EXCLUDE_DIR_NAMES.has(entry.name)) continue;
			const abs = path.join(current, entry.name);
			if (entry.isDirectory()) {
				await walk(abs, depth + 1);
				continue;
			}
			if (!entry.isFile()) continue;
			out.push(path.relative(cwd, abs).split(path.sep).join("/"));
		}
	};

	await walk(root, 0);
	return out;
}

async function listViaRgFiles(
	pi: ExtensionAPI,
	cwd: string,
	dir: string,
	signal?: AbortSignal,
): Promise<string[] | null> {
	try {
		const result = await pi.exec(
			"rg",
			[
				"--files",
				"--glob", "!**/{node_modules,dist,build,.venv,venv,__pycache__,vendor,.next,coverage,target}/**",
				"--glob", "!*.min.js",
				"--glob", "!*.lock",
				"--",
				dir,
			],
			{ cwd, signal, timeout: 5000 },
		);
		if (result.code === 127) return null;
		if (result.code !== 0 && result.code !== 1) return null;
		return result.stdout
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);
	} catch {
		return null;
	}
}

async function rgKeywordHits(
	pi: ExtensionAPI,
	cwd: string,
	dir: string,
	keywords: string[],
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<Map<string, { matched: Set<string>; hits: number }> | null> {
	if (keywords.length === 0) return new Map();
	const args = [
		"-o", "-i", "-F",
		"--no-heading",
		"--with-filename",
		"--no-line-number",
		"--no-messages",
		"--max-count", "50",
		"--max-filesize", "512K",
		"--max-columns", "200",
		"--glob", "*.{ts,tsx,js,jsx,mjs,cjs,py,go,rs,java,kt,rb,php,cs,swift,c,h,cc,cpp,hpp,sh,sql,md,mdx}",
		"--glob", "!**/{node_modules,dist,build,.venv,venv,__pycache__,vendor,.next,coverage,target}/**",
	];
	for (const kw of keywords) {
		args.push("-e", kw);
	}
	args.push("--", dir);

	try {
		const result = await pi.exec("rg", args, { cwd, signal, timeout: timeoutMs });
		if (result.code === 127) return null;
		if (result.code !== 0 && result.code !== 1) return null;
		const map = new Map<string, { matched: Set<string>; hits: number }>();
		const lines = result.stdout.split("\n");
		let bytes = 0;
		for (const line of lines) {
			bytes += line.length + 1;
			if (bytes > 2_000_000) break;
			const idx = line.indexOf(":");
			if (idx <= 0) continue;
			const file = line.slice(0, idx).trim();
			const match = line.slice(idx + 1).trim().toLowerCase();
			if (!file || !match) continue;
			let entry = map.get(file);
			if (!entry) {
				entry = { matched: new Set(), hits: 0 };
				map.set(file, entry);
			}
			entry.hits += 1;
			for (const kw of keywords) {
				if (match.includes(kw)) entry.matched.add(kw);
			}
		}
		return map;
	} catch {
		return null;
	}
}

function synthesizeListing(rels: string[], dirRel: string, maxChars: number): string {
	const prefix = dirRel.replace(/\\/g, "/").replace(/\/?$/, "/");
	const rows = new Set<string>();
	for (const rel of rels.slice(0, 200)) {
		const rest = rel.startsWith(prefix) ? rel.slice(prefix.length) : rel;
		const parts = rest.split("/").filter(Boolean);
		if (parts.length === 0) continue;
		rows.add(`${prefix}${parts[0]}${parts.length > 1 ? "/" : ""}`);
		if (parts.length > 1) rows.add(`${prefix}${parts[0]}/${parts[1]}`);
	}
	const body = [...rows].sort().join("\n");
	if (body.length <= maxChars) return body;
	return `${body.slice(0, maxChars)}\n[truncated]`;
}

/**
 * Rank files under a directory for Path Context. Prefer rg when present;
 * fall back to git ls-files then a bounded fs walk (Alpine-safe).
 */
export async function expandDirectory(
	pi: ExtensionAPI,
	cwd: string,
	dirAbs: string,
	opts: ExpandOptions,
): Promise<{ files: ExpandedFile[]; listing: string; via: "rg" | "git" | "walk" }> {
	const dirRel = path.relative(cwd, dirAbs).split(path.sep).join("/") || ".";
	const keywords = extractKeywords(opts.task);
	const taskMentionsTests = /\btests?\b/i.test(opts.task);

	let via: "rg" | "git" | "walk" = "walk";
	let candidates = await listViaRgFiles(pi, cwd, dirRel === "." ? dirAbs : dirRel, opts.signal);
	if (candidates) {
		via = "rg";
	} else {
		candidates = await listViaGit(pi, cwd, dirRel === "." ? "." : dirRel, opts.signal);
		if (candidates.length > 0) via = "git";
		else candidates = await listViaWalk(dirAbs, cwd);
	}

	const code = candidates.filter(isCodePath);
	const docs = candidates.filter(isDocPath);
	const pool = code.length > 0 ? code : docs;

	const hits = via === "rg"
		? await rgKeywordHits(pi, cwd, dirRel === "." ? dirAbs : dirRel, keywords, opts.timeoutMs, opts.signal)
		: null;

	const ranked: ExpandedFile[] = pool.map((rel) => {
		const hit = hits?.get(rel);
		const matched = hit?.matched ?? new Set<string>();
		const score = scoreCandidate(rel, matched, hit?.hits ?? 0, keywords, taskMentionsTests);
		return {
			abs: path.resolve(cwd, rel),
			rel,
			score,
			matched: [...matched].sort(),
		};
	});

	ranked.sort((a, b) => b.score - a.score || a.rel.localeCompare(b.rel));
	const files = ranked.slice(0, Math.max(0, opts.perDir));
	const listing = synthesizeListing(pool, dirRel, 1500);
	return { files, listing, via };
}
