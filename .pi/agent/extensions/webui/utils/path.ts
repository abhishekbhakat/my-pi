import { dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { getPackageDir } from "@earendil-works/pi-coding-agent";

const PACKAGE_NAME = "@earendil-works/pi-coding-agent";

/**
 * Resolve the installed pi coding agent package root and its export-html assets.
 *
 * Prefer pi's own getPackageDir() (works inside the running pi process on every OS).
 * Fall back to argv entry, npm global prefix, and PATH shims — including Windows
 * where `which` does not exist and npm installs `pi`/`pi.cmd` next to node_modules.
 */

let cachedRoot: string | undefined;
let cachedExportDir: string | undefined;
let cachedThemesDir: string | undefined;

function isPiPackageRoot(dir: string): boolean {
	const pkgPath = join(dir, "package.json");
	if (!existsSync(pkgPath)) return false;
	try {
		const content = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string };
		return content.name === PACKAGE_NAME;
	} catch {
		return false;
	}
}

function hasExportHtml(dir: string): boolean {
	return (
		existsSync(join(dir, "template.html")) ||
		existsSync(join(dir, "dist", "core", "export-html", "template.html")) ||
		existsSync(join(dir, "core", "export-html", "template.html")) ||
		existsSync(join(dir, "export-html", "template.html"))
	);
}

function walkForPackageRoot(startDir: string): string | undefined {
	let dir = startDir;
	while (dir !== dirname(dir)) {
		if (isPiPackageRoot(dir)) return dir;
		dir = dirname(dir);
	}
	return undefined;
}

function resolveExportHtmlDir(packageRoot: string): string {
	// Bun/binary layout: export-html/ next to the package/executable root
	const bunLayout = join(packageRoot, "export-html");
	if (existsSync(join(bunLayout, "template.html"))) return bunLayout;

	// Normal npm install: <root>/dist/core/export-html
	const distLayout = join(packageRoot, "dist", "core", "export-html");
	if (existsSync(join(distLayout, "template.html"))) return distLayout;

	// getPackageDir may already be pointing at dist/
	const fromDist = join(packageRoot, "core", "export-html");
	if (existsSync(join(fromDist, "template.html"))) return fromDist;

	// Dev/tsx layout
	const srcLayout = join(packageRoot, "src", "core", "export-html");
	if (existsSync(join(srcLayout, "template.html"))) return srcLayout;

	return distLayout;
}

function resolveThemesDir(packageRoot: string): string {
	const bunLayout = join(packageRoot, "theme");
	if (existsSync(bunLayout)) return bunLayout;

	const distLayout = join(packageRoot, "dist", "modes", "interactive", "theme");
	if (existsSync(distLayout)) return distLayout;

	const fromDist = join(packageRoot, "modes", "interactive", "theme");
	if (existsSync(fromDist)) return fromDist;

	const srcLayout = join(packageRoot, "src", "modes", "interactive", "theme");
	if (existsSync(srcLayout)) return srcLayout;

	return distLayout;
}

function resolveFromArgv(): string | undefined {
	const entry = process.argv[1];
	if (!entry) return undefined;
	try {
		return walkForPackageRoot(dirname(entry));
	} catch {
		return undefined;
	}
}

function resolveFromThisFile(): string | undefined {
	try {
		// fileURLToPath is the OS-correct way (handles Windows drive letters).
		const thisFile = fileURLToPath(import.meta.url);
		return walkForPackageRoot(dirname(thisFile));
	} catch {
		return undefined;
	}
}

function firstPathFromCommand(command: string, args: string[]): string | undefined {
	try {
		const out = execFileSync(command, args, {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
			shell: false,
		});
		return out
			.split(/\r?\n/)
			.map((line) => line.trim())
			.find(Boolean);
	} catch {
		return undefined;
	}
}

function resolveFromPiBinary(): string | undefined {
	const binPath =
		process.platform === "win32"
			? firstPathFromCommand("where.exe", ["pi"])
			: firstPathFromCommand("which", ["pi"]);
	if (!binPath) return undefined;

	// Unix npm often symlinks pi -> .../dist/cli.js
	const fromBin = walkForPackageRoot(dirname(binPath));
	if (fromBin) return fromBin;

	// Windows/npm shims live in <prefix>/pi(.cmd) beside <prefix>/node_modules/
	const neighbor = join(dirname(binPath), "node_modules", PACKAGE_NAME);
	if (isPiPackageRoot(neighbor)) return neighbor;

	return undefined;
}

function resolveFromNpmRoot(): string | undefined {
	// npm.cmd on Windows needs a shell; execFile without shell fails for .cmd.
	try {
		const npmRoot = execFileSync("npm", ["root", "-g"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
			shell: process.platform === "win32",
		})
			.trim()
			.split(/\r?\n/)
			.map((line) => line.trim())
			.find(Boolean);
		if (!npmRoot) return undefined;
		const candidate = join(npmRoot, PACKAGE_NAME);
		if (isPiPackageRoot(candidate)) return candidate;
	} catch {
		// ignore
	}
	return undefined;
}

function resolveFromEnv(): string | undefined {
	const envDir = process.env.PI_PACKAGE_DIR;
	if (!envDir) return undefined;
	if (isPiPackageRoot(envDir) || hasExportHtml(envDir)) return envDir;
	return undefined;
}

export function getPiPackageRoot(): string {
	if (cachedRoot) return cachedRoot;

	// 1. Official API from the running pi package (best; OS-agnostic).
	try {
		const root = getPackageDir();
		if (root && (isPiPackageRoot(root) || hasExportHtml(root))) {
			cachedRoot = root;
			return root;
		}
	} catch {
		// Package API unavailable in this load context.
	}

	const candidates = [
		resolveFromEnv(),
		resolveFromArgv(),
		resolveFromThisFile(),
		resolveFromPiBinary(),
		resolveFromNpmRoot(),
	];

	for (const candidate of candidates) {
		if (candidate) {
			cachedRoot = candidate;
			return candidate;
		}
	}

	throw new Error(
		`Could not resolve ${PACKAGE_NAME} install location. ` +
			`Reinstall pi, or set PI_PACKAGE_DIR to the package root.`,
	);
}

export function getCoreExportHtmlDir(): string {
	if (cachedExportDir) return cachedExportDir;
	const dir = resolveExportHtmlDir(getPiPackageRoot());
	if (!existsSync(join(dir, "template.html"))) {
		throw new Error(
			`pi export-html assets not found at ${dir}. ` +
				`Expected template.html under the pi package (dist/core/export-html).`,
		);
	}
	cachedExportDir = dir;
	return dir;
}

export function getCoreThemesDir(): string {
	if (cachedThemesDir) return cachedThemesDir;
	cachedThemesDir = resolveThemesDir(getPiPackageRoot());
	return cachedThemesDir;
}

export function getCoreExportAssetPath(...parts: string[]): string {
	return join(getCoreExportHtmlDir(), ...parts);
}
