/**
 * Delete a session JSONL via the `trash` CLI when available (reversible),
 * falling back to fs.unlink. Never touches running sessions.
 */
import { unlinkSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

function hasTrash(): boolean {
	try {
		execFileSync("which", ["trash"], { encoding: "utf8", timeout: 2000 });
		return true;
	} catch {
		return false;
	}
}

export function deleteSessionFile(path: string): void {
	if (!existsSync(path)) throw new Error(`not found: ${path}`);
	if (hasTrash()) {
		try {
			execFileSync("trash", [path], { timeout: 5000 });
			return;
		} catch {
			// fall through to unlink
		}
	}
	unlinkSync(path);
}
