import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { die } from "../errors.mjs";
import { exists } from "../fs/read-write.mjs";
import { relPosix, walkFiles, writeIfChanged } from "../fs/tree.mjs";
import { HOME_AGENT, REPO_AGENT, REPO_ROOT, SYNC_ROOT } from "../paths.mjs";
import { mergeAuth } from "./merge-auth.mjs";

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

export function sync(flags) {
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
