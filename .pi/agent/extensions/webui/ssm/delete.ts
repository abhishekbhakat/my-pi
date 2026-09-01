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

function isGone(error: unknown): boolean {
	return Boolean(
		error &&
			typeof error === "object" &&
			"code" in error &&
			(error as { code?: string }).code === "ENOENT",
	);
}

/** Remove session file. Missing path (ENOENT) is success. */
export function deleteSessionFile(path: string): void {
	if (hasTrash()) {
		try {
			execFileSync("trash", [path], { timeout: 5000 });
			return;
		} catch (error) {
			// trash exits non-zero when missing; still try unlink for real errors.
			if (!existsSync(path)) return;
			// fall through to unlink
			void error;
		}
	}
	try {
		unlinkSync(path);
	} catch (error) {
		if (isGone(error)) return;
		throw error;
	}
}
