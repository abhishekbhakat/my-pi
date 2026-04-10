import { dirname, join } from "node:path";
import { existsSync, readFileSync, realpathSync } from "node:fs";

/**
 * Resolve the installed pi coding agent package root directory.
 *
 * Pi extensions run inside pi's Node.js process via jiti, which means
 * require.resolve works against pi's own module graph. If that fails,
 * we walk up from this file looking for a package.json with the right name.
 * As a final fallback, we resolve via the `pi` binary symlink.
 */
let cachedRoot: string | undefined;

export function getPiPackageRoot(): string {
	if (cachedRoot) return cachedRoot;

	// Strategy 1: require.resolve inside pi's process context
	try {
		const pkgJsonPath = require.resolve("@mariozechner/pi-coding-agent/package.json");
		const root = dirname(pkgJsonPath);
		cachedRoot = root;
		return root;
	} catch {
		// Not available via require.resolve in this context
	}

	// Strategy 2: Walk up from this file to find pi package
	// Matches pi's own getPackageDir() heuristic
	const thisDir = dirname(
		new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"),
	);
	let dir = thisDir;
	while (dir !== dirname(dir)) {
		const pkg = join(dir, "package.json");
		if (existsSync(pkg)) {
			try {
				const content = JSON.parse(readFileSync(pkg, "utf8"));
				if (content.name === "@mariozechner/pi-coding-agent") {
					cachedRoot = dir;
					return dir;
				}
			} catch {
				// Not a valid package.json, skip
			}
		}
		dir = dirname(dir);
	}

	// Strategy 3: Resolve through pi binary symlink
	try {
		const { execSync } = require("node:child_process");
		const which = execSync("which pi", { encoding: "utf8" }).trim();
		const realBin = realpathSync(which);
		// pi -> ../lib/node_modules/@mariozechner/pi-coding-agent/dist/cli.js
		// package root = dirname(dirname(realpath))
		const root = dirname(dirname(realBin));
		cachedRoot = root;
		return root;
	} catch {
		// Last resort: known homebrew path
	}

	const fallback = "/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent";
	cachedRoot = fallback;
	return fallback;
}

export function getCoreExportHtmlDir(): string {
	return join(getPiPackageRoot(), "dist", "core", "export-html");
}

export function getCoreExportAssetPath(...parts: string[]): string {
	return join(getCoreExportHtmlDir(), ...parts);
}