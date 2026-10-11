import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { Tool } from "@earendil-works/pi-ai";

const MAX_LINES = 400;
const MAX_CHARS = 16_000;

/** Secret-ish basenames blocked anywhere under the scout roots. */
const DENY_BASENAME_RE = /^(auth\.json|\.env|\.env\..*|.*\.pem|id_rsa|id_ed25519)$/i;

export type ScoutReadArgs = {
	path: string;
	offset?: number;
	limit?: number;
};

const SCOUT_READ_PARAMETERS = {
	type: "object",
	properties: {
		path: { type: "string", description: "Workspace-relative or absolute path to read" },
		offset: { type: "integer", minimum: 1, description: "1-based start line" },
		limit: {
			type: "integer",
			minimum: 1,
			maximum: MAX_LINES,
			description: "Max lines to return",
		},
	},
	required: ["path"],
	additionalProperties: false,
} as const;

export const SCOUT_READ_TOOL = {
	name: "read",
	description:
		"Read a text file from the workspace. Prefer paths under the scout roots. Returns numbered lines.",
	parameters: SCOUT_READ_PARAMETERS,
} as Tool;

function numberLines(text: string, startLine: number): string {
	const lines = text.split("\n");
	const width = String(startLine + lines.length - 1).length;
	return lines
		.map((line, index) => `${String(startLine + index).padStart(width, " ")}|${line}`)
		.join("\n");
}

export interface ScoutReadContext {
	cwd: string;
	/** Absolute roots the scout may read under (repo cwd + explicit path roots). */
	roots: string[];
}

async function resolveAllowedPath(rawPath: string, ctx: ScoutReadContext): Promise<string> {
	const abs = path.resolve(ctx.cwd, rawPath);
	let real: string;
	try {
		real = await fs.realpath(abs);
	} catch {
		throw new Error(`file not found: ${rawPath}`);
	}

	const roots = await Promise.all(
		ctx.roots.map(async (root) => {
			try {
				return await fs.realpath(root);
			} catch {
				return path.resolve(root);
			}
		}),
	);

	const underRoot = roots.some((root) => real === root || real.startsWith(root + path.sep));
	if (!underRoot) throw new Error(`path outside scout roots: ${rawPath}`);

	// Live agent home only — repo source under <project>/.pi/agent stays readable.
	const homePi = path.join(os.homedir(), ".pi");
	if (real === homePi || real.startsWith(homePi + path.sep)) {
		throw new Error(`path denied: ${rawPath}`);
	}
	if (DENY_BASENAME_RE.test(path.basename(real))) {
		throw new Error(`path denied: ${rawPath}`);
	}
	if (real.split(path.sep).includes("node_modules")) {
		throw new Error(`path denied: ${rawPath}`);
	}
	return real;
}

export async function executeScoutRead(
	args: ScoutReadArgs,
	ctx: ScoutReadContext,
): Promise<{ text: string; isError: boolean }> {
	try {
		const abs = await resolveAllowedPath(String(args.path ?? ""), ctx);
		const stat = await fs.stat(abs);
		if (!stat.isFile()) return { text: `not a file: ${args.path}`, isError: true };

		const raw = await fs.readFile(abs, "utf8");
		if (raw.includes("\u0000")) return { text: `binary file skipped: ${args.path}`, isError: true };

		const lines = raw.split("\n");
		const offset = Math.max(1, args.offset ?? 1);
		const limit = Math.min(MAX_LINES, args.limit ?? MAX_LINES);
		const slice = lines.slice(offset - 1, offset - 1 + limit);
		let body = numberLines(slice.join("\n"), offset);
		if (body.length > MAX_CHARS) {
			body = `${body.slice(0, MAX_CHARS)}\n[truncated]`;
		}
		const rel = path.relative(ctx.cwd, abs).split(path.sep).join("/") || path.basename(abs);
		return {
			text: `## ${rel} (lines ${offset}-${offset + slice.length - 1})\n\`\`\`\n${body}\n\`\`\``,
			isError: false,
		};
	} catch (error) {
		return {
			text: error instanceof Error ? error.message : String(error),
			isError: true,
		};
	}
}

export function buildScoutTools(names: string[]): Tool[] {
	const out: Tool[] = [];
	for (const name of names) {
		if (name === "read") out.push(SCOUT_READ_TOOL);
	}
	return out;
}

export async function executeScoutTool(
	name: string,
	args: Record<string, unknown>,
	ctx: ScoutReadContext,
): Promise<{ text: string; isError: boolean }> {
	if (name === "read") {
		return executeScoutRead(args as ScoutReadArgs, ctx);
	}
	return { text: `unsupported scout tool: ${name} (only read is available)`, isError: true };
}
