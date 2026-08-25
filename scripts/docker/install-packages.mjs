#!/usr/bin/env node
/**
 * Install packages listed in ~/.pi/agent/settings.json via `pi install`.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const settingsPath = path.join(os.homedir(), ".pi", "agent", "settings.json");
if (!fs.existsSync(settingsPath)) {
	console.log("  no settings.json; skip packages");
	process.exit(0);
}

const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
const packages = settings.packages ?? [];
const sources = packages.map((pkg) => (typeof pkg === "string" ? pkg : pkg.source)).filter(Boolean);

if (!sources.length) {
	console.log("  no packages configured");
	process.exit(0);
}

let failed = 0;
for (const source of sources) {
	console.log(`  pi install ${source}`);
	const result = spawnSync("pi", ["install", source], {
		encoding: "utf8",
		stdio: "inherit",
		env: process.env,
	});
	if (result.status !== 0) {
		console.error(`  WARNING: pi install failed for ${source}`);
		failed += 1;
	}
}

process.exit(failed ? 1 : 0);
