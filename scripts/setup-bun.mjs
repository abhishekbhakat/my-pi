#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function bunRoot() {
  return process.env.BUN_INSTALL || path.join(os.homedir(), ".bun");
}

function bunBinDir() {
  return path.join(bunRoot(), "bin");
}

function bunPath() {
  return path.join(bunBinDir(), process.platform === "win32" ? "bun.exe" : "bun");
}

function bunOnPath() {
  const result = spawnSync("bun", ["--version"], { stdio: "ignore", shell: process.platform === "win32" });
  return !result.error && result.status === 0;
}

function prependBunBin() {
  const dir = bunBinDir();
  const parts = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  if (!parts.includes(dir)) process.env.PATH = [dir, ...parts].join(path.delimiter);
}

function installBun() {
  if (process.platform === "win32") {
    return spawnSync(
      "powershell",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "irm https://bun.sh/install.ps1 | iex"],
      { stdio: "inherit" },
    );
  }
  return spawnSync("bash", ["-c", "curl -fsSL https://bun.sh/install | bash"], { stdio: "inherit" });
}

if (bunOnPath()) {
  console.log("  bun already on PATH");
  process.exit(0);
}

prependBunBin();
if (exists(bunPath()) || bunOnPath()) {
  console.log(`  bun present at ${bunPath()} (not on PATH; this process prepended ${bunBinDir()})`);
  process.exit(0);
}

console.log("  bun missing; running official installer (bun.sh)");
const result = installBun();
if (result.error) {
  console.error(`  bun installer error: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);

prependBunBin();
if (!exists(bunPath()) && !bunOnPath()) {
  console.error("  bun installer exited 0 but bun binary not found");
  process.exit(1);
}
console.log(`  bun at ${bunPath()}`);
console.log(`  add ${bunBinDir()} to PATH in your shell rc if new shells cannot find bun`);
