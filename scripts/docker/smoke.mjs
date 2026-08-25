#!/usr/bin/env node
/**
 * Smoke-test my-pi install inside Docker (or any clean HOME).
 * 1) run make install
 * 2) assert live ~/.pi/agent layout + JSON + capability models
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../..");
const HOME_AGENT = path.join(os.homedir(), ".pi", "agent");

let failed = 0;

function ok(msg) {
	console.log(`  OK  ${msg}`);
}

function fail(msg) {
	console.error(`  FAIL  ${msg}`);
	failed += 1;
}

function assert(cond, msg) {
	if (cond) ok(msg);
	else fail(msg);
}

function exists(p) {
	try {
		fs.accessSync(p);
		return true;
	} catch {
		return false;
	}
}

function readJson(p) {
	return JSON.parse(fs.readFileSync(p, "utf8"));
}

function run(cmd, args, cwd = REPO_ROOT) {
	const result = spawnSync(cmd, args, {
		cwd,
		encoding: "utf8",
		env: process.env,
		stdio: ["ignore", "pipe", "pipe"],
	});
	return result;
}

console.log("== my-pi docker smoke ==");
console.log(`repo: ${REPO_ROOT}`);
console.log(`HOME: ${os.homedir()}`);
console.log(`agent: ${HOME_AGENT}\n`);

// Entrypoint already ran make install (+ optional auth/packages).
// Re-run install only when invoked outside the entrypoint.
console.log("[1] make install");
if (exists(path.join(HOME_AGENT, "settings.json"))) {
	ok("install already applied by entrypoint");
} else {
	const install = run("make", ["install"]);
	process.stdout.write(install.stdout || "");
	process.stderr.write(install.stderr || "");
	assert(install.status === 0, "make install exit 0");
}

console.log("\n[2] live agent files");
for (const rel of [
	"settings.json",
	"models.json",
	"SYSTEM.md",
	"damage-control-rules.yaml",
	"extensions/package.json",
	"extensions/capability-tools/definitions.ts",
	"extensions/capability-tools/capabilities/code-scout.md",
	"extensions/capability-tools/capabilities/commit-message.md",
	"extensions/capability-tools/capabilities/reasoning-coach.md",
	"extensions/capability-tools/capabilities/patch-reviewer.md",
]) {
	assert(exists(path.join(HOME_AGENT, rel)), rel);
}

console.log("\n[3] extensions npm deps");
assert(exists(path.join(HOME_AGENT, "extensions/node_modules")), "extensions/node_modules present");
assert(exists(path.join(HOME_AGENT, "extensions/node_modules/yaml")), "yaml installed");

console.log("\n[4] settings.json");
const settings = readJson(path.join(HOME_AGENT, "settings.json"));
assert(typeof settings.defaultProvider === "string", `defaultProvider=${settings.defaultProvider}`);
assert(Array.isArray(settings.enabledModels) && settings.enabledModels.length > 0, "enabledModels non-empty");
assert(
	settings.enabledModels.includes("commandcode/stealth/ox-alpha"),
	"enabledModels includes commandcode/stealth/ox-alpha",
);
assert(Array.isArray(settings.packages), "packages array");

console.log("\n[5] models.json");
const models = readJson(path.join(HOME_AGENT, "models.json"));
assert(models.providers && typeof models.providers === "object", "providers object");
assert(models.providers.commandcode, "commandcode provider");
assert(!models.providers["claude-code-cli"], "claude-code-cli removed");
assert(!models.providers.venice, "venice removed");
const ox = (models.providers.commandcode.models || []).find((m) => m.id === "stealth/ox-alpha");
assert(!!ox, "stealth/ox-alpha model entry");
if (ox) {
	const map = ox.thinkingLevelMap || {};
	assert(map.low === "low", "ox-alpha low");
	assert(map.medium === "medium", "ox-alpha medium");
	assert(map.high === "high", "ox-alpha high");
	assert(map.off == null, "ox-alpha off hidden");
	assert(map.xhigh == null, "ox-alpha xhigh hidden");
	assert(map.max == null, "ox-alpha max hidden");
}
assert(settings.defaultProvider === "commandcode", `defaultProvider=${settings.defaultProvider}`);
assert(settings.defaultModel === "stealth/ox-alpha", `defaultModel=${settings.defaultModel}`);
assert(!(settings.packages || []).includes("npm:claude-code-pi"), "claude-code-pi package removed");

console.log("\n[6] capability frontmatter models");
const expected = {
	"code-scout.md": { model: "commandcode/stealth/ox-alpha", reasoningEffort: "low" },
	"commit-message.md": { model: "commandcode/stealth/ox-alpha", reasoningEffort: "low" },
	"reasoning-coach.md": { model: "commandcode/stealth/ox-alpha", reasoningEffort: "medium" },
	"patch-reviewer.md": { model: "commandcode/stealth/ox-alpha", reasoningEffort: "high" },
};
const capDir = path.join(HOME_AGENT, "extensions/capability-tools/capabilities");
for (const [file, want] of Object.entries(expected)) {
	const raw = fs.readFileSync(path.join(capDir, file), "utf8");
	const match = raw.match(/^---\n([\s\S]*?)\n---/);
	assert(!!match, `${file} has frontmatter`);
	if (!match) continue;
	const fm = Object.fromEntries(
		match[1]
			.split("\n")
			.map((line) => {
				const i = line.indexOf(":");
				if (i <= 0) return null;
				return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
			})
			.filter(Boolean),
	);
	assert(fm.model === want.model, `${file} model=${fm.model}`);
	assert(fm.reasoningEffort === want.reasoningEffort, `${file} reasoningEffort=${fm.reasoningEffort}`);
	if (fm.timelineModel) {
		assert(fm.timelineModel === "commandcode/stealth/ox-alpha", `${file} timelineModel=${fm.timelineModel}`);
		assert(fm.timelineReasoningEffort === "low", `${file} timelineReasoningEffort=${fm.timelineReasoningEffort}`);
	}
}

console.log("\n[7] auth.json");
const authPath = path.join(HOME_AGENT, "auth.json");
if (exists(authPath)) {
	const auth = readJson(authPath);
	assert(!!auth.commandcode?.key, "commandcode key present in auth.json");
	const list = run("pi", ["--list-models"]);
	const out = `${list.stdout || ""}${list.stderr || ""}`;
	if (list.status === 0 && /stealth\/ox-alpha|commandcode/i.test(out)) {
		ok("pi --list-models shows commandcode/ox-alpha");
	} else if (/No models available/i.test(out)) {
		fail("pi still reports no models despite auth.json");
		console.error(out.slice(0, 400));
	} else {
		ok(`auth.json present (list-models exit ${list.status})`);
		if (out.trim()) console.log(out.trim().split("\n").slice(0, 8).map((l) => `    ${l}`).join("\n"));
	}
} else {
	console.log("  SKIP  no auth.json in image (add .pi/agent/auth.json before build)");
}

console.log("\n[8] pi CLI (optional)");
const piVersion = run("pi", ["--version"]);
if (piVersion.status === 0) {
	ok(`pi --version -> ${(piVersion.stdout || piVersion.stderr || "").trim()}`);
} else {
	console.log("  SKIP  pi not on PATH (install still validated)");
}

console.log("\n=============================");
if (failed) {
	console.error(`Smoke FAILED (${failed} check(s))`);
	process.exit(1);
}
console.log("Smoke PASSED");
