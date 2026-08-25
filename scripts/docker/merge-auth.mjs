#!/usr/bin/env node
/**
 * Merge auth overlay into dest auth.json (provider keys override).
 *
 *   node scripts/docker/merge-auth.mjs /secrets/auth.json ~/.pi/agent/auth.json
 *   node scripts/docker/merge-auth.mjs --commandcode-env ~/.pi/agent/auth.json
 *   node scripts/docker/merge-auth.mjs --venice-env ~/.pi/agent/auth.json
 */
import fs from "node:fs";
import path from "node:path";

function readJson(filePath, fallback = {}) {
	if (!fs.existsSync(filePath)) return fallback;
	const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
	if (!data || typeof data !== "object" || Array.isArray(data)) {
		throw new Error(`${filePath} must be a JSON object`);
	}
	return data;
}

function writeAuth(destPath, data) {
	fs.mkdirSync(path.dirname(destPath), { recursive: true });
	fs.writeFileSync(destPath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
}

const args = process.argv.slice(2);
if (args.length < 1) {
	console.error("usage: merge-auth.mjs <overlay.json> <dest.json>");
	console.error("   or: merge-auth.mjs --commandcode-env <dest.json>");
	console.error("   or: merge-auth.mjs --venice-env <dest.json>");
	process.exit(2);
}

if (args[0] === "--commandcode-env") {
	const dest = args[1];
	const key = process.env.COMMANDCODE_API_KEY || process.env.CMD_API_KEY;
	if (!key) {
		console.error("COMMANDCODE_API_KEY / CMD_API_KEY not set");
		process.exit(1);
	}
	const data = readJson(dest, {});
	data.commandcode = { type: "api_key", key };
	writeAuth(dest, data);
	console.log(`  wrote commandcode key -> ${dest}`);
	process.exit(0);
}

if (args[0] === "--venice-env") {
	const dest = args[1];
	const key = process.env.VENICE_API_KEY;
	if (!key) {
		console.error("VENICE_API_KEY not set");
		process.exit(1);
	}
	const data = readJson(dest, {});
	data.venice = { type: "api_key", key };
	writeAuth(dest, data);
	console.log(`  wrote venice key -> ${dest}`);
	process.exit(0);
}

const [overlayPath, destPath] = args;
if (!destPath) {
	console.error("dest path required");
	process.exit(2);
}
const dest = readJson(destPath, {});
const overlay = readJson(overlayPath);
const merged = { ...dest, ...overlay };
writeAuth(destPath, merged);
const added = Object.keys(overlay).filter((k) => !Object.hasOwn(dest, k));
const overridden = Object.keys(overlay).filter((k) => Object.hasOwn(dest, k));
console.log(`  merged ${overlayPath} -> ${destPath}`);
if (added.length) console.log(`  added: ${added.join(", ")}`);
if (overridden.length) console.log(`  overrode: ${overridden.join(", ")}`);
