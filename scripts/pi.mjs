#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const HOME_AGENT = path.join(os.homedir(), ".pi", "agent");
const REPO_AGENT = path.join(REPO_ROOT, ".pi", "agent");
const SKIP_DIRS = new Set(["node_modules", ".git"]);
const TEXT_EXT = new Set([
  ".ts", ".js", ".mjs", ".cjs", ".json", ".md", ".yaml", ".yml", ".txt",
  ".css", ".html", ".htm", ".svg", ".xml", ".sh", ".bash", ".zsh",
  ".ps1", ".bat", ".cmd", ".py", ".toml", ".ini", ".cfg", ".conf",
]);
const TEXT_NAME = new Set([
  "LICENSE", "README", "Makefile", ".gitignore", ".gitattributes", ".npmrc", ".editorconfig",
]);
const INSTALL_ROOT = ["settings.json", "models.json", "damage-control-rules.yaml", "SYSTEM.md"];
const SYNC_ROOT = [
  "settings.json", "models.json", "models-store.json",
  "damage-control-rules.yaml", "SYSTEM.md",
];

function die(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function readJsonObject(filePath, fallback) {
  if (!exists(filePath)) {
    if (fallback !== undefined) return fallback;
    die(`missing ${filePath}`);
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    die(`invalid JSON in ${filePath}: ${error.message}`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    die(`${filePath} must be a JSON object`);
  }
  return data;
}

function writeAtomic(dest, contents, mode) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = path.join(path.dirname(dest), `.tmp-${process.pid}-${Date.now()}${path.extname(dest)}`);
  fs.writeFileSync(tmp, contents);
  try {
    fs.renameSync(tmp, dest);
  } catch {
    fs.copyFileSync(tmp, dest);
    fs.unlinkSync(tmp);
  }
  if (mode && process.platform !== "win32") fs.chmodSync(dest, mode);
}

function isOauthEntry(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && value.type === "oauth");
}

function mergeAuth(destPath, overlayPath, options = {}) {
  const skipOauth = Boolean(options.skipOauth);
  if (!exists(overlayPath)) {
    console.log("  Skipping auth.json merge; overlay not found.");
    return;
  }
  const dest = readJsonObject(destPath, {});
  const overlay = readJsonObject(overlayPath);
  const applied = {};
  const skippedOauth = [];
  for (const [key, value] of Object.entries(overlay)) {
    if (skipOauth && isOauthEntry(value)) {
      skippedOauth.push(key);
      continue;
    }
    applied[key] = value;
  }
  const merged = { ...dest, ...applied };
  const destKeys = Object.keys(dest);
  const appliedKeys = Object.keys(applied);
  const added = appliedKeys.filter((key) => !Object.hasOwn(dest, key)).sort();
  const overridden = appliedKeys.filter((key) => Object.hasOwn(dest, key)).sort();
  const kept = destKeys.filter((key) => !Object.hasOwn(applied, key)).sort();
  writeAtomic(destPath, `${JSON.stringify(merged, null, 2)}\n`, 0o600);
  console.log(`  Merged auth.json -> ${destPath}`);
  if (added.length) console.log(`  Added: ${added.join(", ")}`);
  if (overridden.length) console.log(`  Overrode: ${overridden.join(", ")}`);
  if (kept.length) console.log(`  Kept: ${kept.join(", ")}`);
  if (skippedOauth.length) console.log(`  Skipped oauth (home-only install): ${skippedOauth.sort().join(", ")}`);
  if (!added.length && !overridden.length) console.log("  No incoming provider keys to apply.");
}

function rmTree(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function copyDirReplace(src, dst) {
  if (!exists(src)) return false;
  rmTree(dst);
  fs.cpSync(src, dst, { recursive: true });
  for (const file of walkFiles(dst)) {
    if (path.basename(file) === "package-lock.json") fs.rmSync(file, { force: true });
  }
  return true;
}

function* walkFiles(root) {
  if (!exists(root)) return;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(full);
      } else if (entry.isFile()) {
        yield full;
      }
    }
  }
}

function relPosix(from, to) {
  return path.relative(from, to).split(path.sep).join("/");
}

function loadSubmodules() {
  const file = path.join(REPO_ROOT, ".gitmodules");
  if (!exists(file)) return [];
  const paths = [];
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*path\s*=\s*(.+?)\s*$/);
    if (match) paths.push(match[1].replaceAll("\\", "/"));
  }
  return paths;
}

function underSubmodule(fullPath, submodules) {
  const rel = relPosix(REPO_ROOT, fullPath);
  return submodules.some((sub) => rel === sub || rel.startsWith(`${sub}/`));
}

function shouldSkipRel(rel) {
  const parts = rel.split("/");
  if (parts.includes("node_modules") || parts.includes(".git")) return true;
  return path.posix.basename(rel) === "package-lock.json";
}

function isTextFile(filePath, bytes) {
  if (bytes.includes(0)) return false;
  const base = path.basename(filePath);
  const ext = path.extname(base).toLowerCase();
  return TEXT_EXT.has(ext) || TEXT_NAME.has(base) || base.startsWith("Makefile");
}

function writeIfChanged(src, dst, stats) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const bytes = fs.readFileSync(src);
  const out = isTextFile(src, bytes) ? Buffer.from(bytes.toString("utf8").replaceAll("\r\n", "\n").replaceAll("\r", "\n")) : bytes;
  if (exists(dst) && Buffer.compare(out, fs.readFileSync(dst)) === 0) {
    stats.unchanged += 1;
    return false;
  }
  fs.writeFileSync(dst, out);
  stats.updated += 1;
  return true;
}

function run(cmd, args, cwd) {
  return spawnSync(cmd, args, { cwd, stdio: "ignore", shell: process.platform === "win32" });
}

function parseArgs(argv) {
  const flags = { yes: false, prune: false, host: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-y") flags.yes = true;
    else if (arg === "-p" || arg === "--prune" || arg === "-Prune") flags.prune = true;
    else if (arg === "-h") {
      flags.host = argv[i + 1];
      i += 1;
      if (!flags.host) die("-h requires a non-empty host.");
    } else if (arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      die(`Unknown option ${arg}`);
    }
  }
  return flags;
}

function normalizeProxyOrigin(host) {
  let origin = host.trim();
  if (!origin || /[\s"\\]/.test(origin)) die("Proxy host must not contain whitespace, quotes, or backslashes.");
  while (origin.endsWith("/")) origin = origin.slice(0, -1);
  if (origin.endsWith("/v1")) {
    origin = origin.slice(0, -3);
    while (origin.endsWith("/")) origin = origin.slice(0, -1);
  }
  if (origin.startsWith("http://") || origin.startsWith("https://")) return origin;
  return origin.includes(":") ? `http://${origin}` : `http://${origin}:8383`;
}

function patchModelsProxy(modelsFile, origin) {
  if (!exists(modelsFile)) {
    console.log("  Skipping proxy update; models.json not found.");
    return;
  }
  const text = fs.readFileSync(modelsFile, "utf8").replace(
    /"baseUrl"\s*:\s*"[^"]*"/g,
    (match) => `"baseUrl": "${origin}${match.endsWith('/v1"') ? "/v1" : ""}"`,
  );
  fs.writeFileSync(modelsFile, text);
  console.log(`  Updated models.json proxy origin to ${origin}.`);
}

function applySparseCheckouts(skillsDir) {
  if (!exists(skillsDir) || run("git", ["--version"]).status !== 0) return;
  const configs = fs.readdirSync(skillsDir).filter((name) => name.endsWith(".sparse-checkout"));
  for (const name of configs) {
    const base = name.replace(/\.sparse-checkout$/, "");
    const submod = path.join(skillsDir, base);
    if (!exists(submod)) {
      console.log(`[sparse-checkout] Skipping ${base}: directory missing`);
      continue;
    }
    if (!exists(path.join(submod, ".git"))) {
      console.log(`[sparse-checkout] Skipping ${base}: not a git checkout`);
      continue;
    }
    const paths = fs.readFileSync(path.join(skillsDir, name), "utf8")
      .split(/\r?\n/)
      .map((line) => line.replace(/#.*$/, "").trim())
      .filter(Boolean);
    if (!paths.length) {
      console.log(`[sparse-checkout] Skipping ${base}: no paths in ${name}`);
      continue;
    }
    console.log(`[sparse-checkout] ${base}: ${paths.join(" ")}`);
    const init = run("git", ["sparse-checkout", "init", "--cone"], submod);
    const set = run("git", ["sparse-checkout", "set", ...paths], submod);
    console.log(init.status === 0 && set.status === 0 ? "  Applied." : `  WARNING: sparse-checkout failed for ${base}.`);
  }
  if (configs.length) console.log("");
}

function install(flags) {
  if (!exists(REPO_AGENT)) die(`Source directory not found: ${REPO_AGENT}`);
  console.log(`Copying .pi/agent -> ${HOME_AGENT}\n`);
  console.log("  Overwriting protected files.\n");
  fs.mkdirSync(HOME_AGENT, { recursive: true });
  let copied = 0;
  let skipped = 0;
  for (const [label, name] of [["extensions", "extensions"], ["skills", "skills"], ["themes", "themes"]]) {
    if (label === "skills") applySparseCheckouts(path.join(REPO_AGENT, "skills"));
    if (label === "extensions") {
      console.log("[extensions]");
      if (copyDirReplace(path.join(REPO_AGENT, name), path.join(HOME_AGENT, name))) {
        console.log("  Files copied.");
        copied += 1;
      }
      console.log("");
      const extDir = path.join(HOME_AGENT, "extensions");
      if (exists(path.join(extDir, "package.json"))) {
        console.log("[extensions npm]");
        const result = run("npm", ["install"], extDir);
        console.log(result.status === 0 ? "  npm install complete.\n" : "  WARNING: npm install failed.\n");
      }
      continue;
    }
    console.log(`[${label}]`);
    if (copyDirReplace(path.join(REPO_AGENT, name), path.join(HOME_AGENT, name))) {
      console.log("  Files copied.");
      copied += 1;
    }
    console.log("");
  }
  console.log("[root files]");
  for (const file of INSTALL_ROOT) {
    const src = path.join(REPO_AGENT, file);
    if (!exists(src)) continue;
    fs.copyFileSync(src, path.join(HOME_AGENT, file));
    console.log(`  Copied ${file}`);
    copied += 1;
  }
  console.log("\n[auth.json]");
  // api_key both ways; oauth only home -> repo (sync). Install never push oauth live.
  mergeAuth(path.join(HOME_AGENT, "auth.json"), path.join(REPO_AGENT, "auth.json"), { skipOauth: true });
  if (flags.host) {
    console.log("\n[models proxy]");
    patchModelsProxy(path.join(HOME_AGENT, "models.json"), normalizeProxyOrigin(flags.host));
  }
  const agentsSrc = path.join(REPO_ROOT, ".pi", "agents");
  if (exists(agentsSrc)) {
    const agentsDst = path.join(os.homedir(), ".pi", "agents");
    console.log("\n[agents]");
    rmTree(agentsDst);
    fs.mkdirSync(agentsDst, { recursive: true });
    for (const file of fs.readdirSync(agentsSrc).filter((name) => name.endsWith(".md"))) {
      fs.copyFileSync(path.join(agentsSrc, file), path.join(agentsDst, file));
    }
    console.log("  Done.");
  }
  console.log(`\n=============================\n Copy complete.\n Copied: ${copied}\n Skipped: ${skipped}\n=============================\n`);
  console.log("Run /reload in pi to pick up changes.");
}

function sync(flags) {
  if (!exists(HOME_AGENT)) die(`Live source directory not found: ${HOME_AGENT}`);
  console.log(`Syncing ${HOME_AGENT} -> .pi/agent\n`);
  console.log("  Overwriting protected files in the repo.\n");
  fs.mkdirSync(REPO_AGENT, { recursive: true });
  const stats = { dirs: 0, updated: 0, unchanged: 0, removed: 0, skipped: 0 };
  const submodules = loadSubmodules();
  for (const name of ["extensions", "skills", "themes"]) {
    const src = path.join(HOME_AGENT, name);
    const dst = path.join(REPO_AGENT, name);
    if (!exists(src)) continue;
    console.log(`[${name}]`);
    if (underSubmodule(dst, submodules)) {
      console.log("  Skipping (git submodule).\n");
      continue;
    }
    fs.mkdirSync(dst, { recursive: true });
    const srcRels = [];
    for (const file of walkFiles(src)) {
      const rel = relPosix(src, file);
      if (shouldSkipRel(rel) || underSubmodule(path.join(dst, rel), submodules)) continue;
      srcRels.push(rel);
      writeIfChanged(file, path.join(dst, ...rel.split("/")), stats);
    }
    if (flags.prune) {
      for (const file of walkFiles(dst)) {
        const rel = relPosix(dst, file);
        if (shouldSkipRel(rel) || underSubmodule(file, submodules)) continue;
        if (!srcRels.includes(rel)) {
          fs.rmSync(file, { force: true });
          stats.removed += 1;
        }
      }
    }
    console.log("  Done.");
    stats.dirs += 1;
    console.log("");
  }
  console.log("[root files]");
  for (const file of SYNC_ROOT) {
    const src = path.join(HOME_AGENT, file);
    if (!exists(src)) continue;
    const changed = writeIfChanged(src, path.join(REPO_AGENT, file), stats);
    console.log(changed ? `  Updated ${file}` : `  Unchanged ${file}`);
  }
  const agentsSrc = path.join(os.homedir(), ".pi", "agents");
  if (exists(agentsSrc)) {
    const agentsDst = path.join(REPO_ROOT, ".pi", "agents");
    console.log("\n[agents]");
    fs.mkdirSync(agentsDst, { recursive: true });
    const files = fs.readdirSync(agentsSrc).filter((name) => name.endsWith(".md"));
    if (!files.length) console.log("  No .md files found.");
    for (const file of files) {
      const changed = writeIfChanged(path.join(agentsSrc, file), path.join(agentsDst, file), stats);
      console.log(changed ? `  Updated ${file}` : `  Unchanged ${file}`);
    }
    console.log("  Done.");
  }
  console.log("\n[auth.json]");
  mergeAuth(path.join(REPO_AGENT, "auth.json"), path.join(HOME_AGENT, "auth.json"));
  console.log("\n=============================");
  console.log(" Sync complete.");
  console.log(` Dirs synced: ${stats.dirs}`);
  console.log(` Files updated: ${stats.updated}`);
  console.log(` Files unchanged: ${stats.unchanged}`);
  console.log(flags.prune ? ` Files removed: ${stats.removed}` : " Files removed: 0 (pass -p to delete repo files missing from live)");
  console.log(` Protected skipped: ${stats.skipped}`);
  console.log("=============================\n");
  console.log("Skipped: bin/, sessions/, node_modules, package-lock.json, git submodules");
  console.log("auth.json: api_key merge both ways; oauth home -> repo only. Never deleted.");
  console.log("Text files normalized to LF (CRLF ignored).");
  console.log("Default is additive (no deletes). Use -p only to mirror-delete.");
  console.log("Review git status, then commit if the repo should keep these changes.");
}

function printHelp() {
  console.log(`my-pi config CLI

Usage:
  node scripts/pi.mjs install [-h HOST]
  node scripts/pi.mjs sync [-p]
  node scripts/pi.mjs help

install  Copy repo .pi/agent -> ~/.pi/agent
sync     Copy live ~/.pi/agent -> repo .pi/agent

-h HOST  Set models.json proxy origin on install
-p       Prune repo files missing from live on sync
-y       Accepted, unused (protected files always overwritten)

auth.json: api_key merge both ways (incoming override, dest-only stay).
  oauth (type=oauth) flows home -> repo on sync only; install never overwrites live oauth.`);
}

const [command, ...rest] = process.argv.slice(2);
if (!command || command === "help" || command === "--help") {
  printHelp();
  process.exit(0);
}
const flags = parseArgs(rest);
if (command === "install") install(flags);
else if (command === "sync") sync(flags);
else die(`Unknown command ${command}. Use install, sync, or help.`);
