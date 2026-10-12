import * as fs from "node:fs/promises";
import * as path from "node:path";

function stripPathSigil(rawPath: string): string {
	return rawPath.trim().replace(/^@+/, "");
}

export interface ScoutPathCheck {
	requested: number;
	found: string[];
	missing: string[];
}

/** Stat each caller path against the session cwd. Missing paths stay listed; they are not guessed. */
export async function classifyScoutPaths(cwd: string, rawPaths: string[]): Promise<ScoutPathCheck> {
	const found: string[] = [];
	const missing: string[] = [];
	let requested = 0;
	for (const raw of rawPaths) {
		const trimmed = stripPathSigil(raw);
		if (!trimmed) continue;
		requested += 1;
		try {
			await fs.stat(path.resolve(cwd, trimmed));
			found.push(trimmed);
		} catch {
			missing.push(trimmed);
		}
	}
	return { requested, found, missing };
}

export function formatMissingScoutPaths(cwd: string, missing: string[]): string {
	return [
		`code_scout: no paths found under cwd ${cwd}.`,
		...missing.map((item) => `- ${item}`),
		"Pass paths that exist in this session, or start pi in the repo that contains them.",
	].join("\n");
}

export function formatNoFilesRead(cwd: string, selected: string[]): string {
	const listed = selected.length > 0 ? selected.join(", ") : "(none)";
	return `no files read\ncwd: ${cwd}\nselected paths: ${listed}`;
}
