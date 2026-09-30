import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { die } from "../errors.mjs";
import { exists } from "../fs/read-write.mjs";
import { REPO_ROOT, SCRIPT_DIR } from "../paths.mjs";
import { commandOnPath, run } from "./run.mjs";

const PI_PKG = "@earendil-works/pi-coding-agent";

export function extensionInstallSpec() {
  if (commandOnPath("bun")) {
    return { cmd: "bun", args: ["install", "--production"] };
  }
  return { cmd: "npm", args: ["install", "--omit=dev", "--no-fund", "--no-audit"] };
}

export function npmGlobalPiDir() {
  const result = spawnSync("npm", ["root", "-g"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.error || result.status !== 0) return null;
  const dir = path.join(result.stdout.trim(), "@earendil-works", "pi-coding-agent");
  return exists(path.join(dir, "package.json")) ? dir : null;
}

export function bunGlobalPiDir() {
  const dir = path.join(os.homedir(), ".bun", "install", "global", "node_modules", "@earendil-works", "pi-coding-agent");
  return exists(path.join(dir, "package.json")) ? dir : null;
}

export function piBinary() {
  const bunHome = process.env.BUN_INSTALL || path.join(os.homedir(), ".bun");
  const local = path.join(bunHome, "bin", process.platform === "win32" ? "pi.cmd" : "pi");
  if (exists(local)) return local;
  return commandOnPath("pi") ? "pi" : null;
}

export function updatePiAndExtensions() {
  const pi = piBinary();
  console.log("[pi update]");
  if (!pi) {
    console.log("  pi binary not found; skipping pi update.\n");
    return;
  }
  for (const args of [["update"], ["update", "--extensions"]]) {
    const result = run(pi, args, REPO_ROOT, { stdio: "inherit", label: `pi ${args.join(" ")}` });
    if (result.status !== 0) {
      console.log(`  WARNING: pi ${args.join(" ")} failed (status ${result.status ?? "unknown"}).`);
    }
  }
  console.log("");
}

export function prependBunBin() {
  const dir = path.join(process.env.BUN_INSTALL || path.join(os.homedir(), ".bun"), "bin");
  const parts = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  if (!parts.includes(dir)) process.env.PATH = [dir, ...parts].join(path.delimiter);
}

export function ensureBun() {
  const setup = path.join(SCRIPT_DIR, "setup-bun.mjs");
  if (!exists(setup)) die(`missing ${setup}`);
  console.log("[bun]");
  const result = run(process.execPath, [setup], REPO_ROOT, {
    stdio: "inherit",
    label: "setup bun",
  });
  if (result.status !== 0) die("bun setup failed.");
  prependBunBin();
  if (!commandOnPath("bun")) die("bun still not on PATH after setup-bun.mjs.");
  console.log("");
}

export function ensureBunPiCli() {
  ensureBun();
  console.log("[pi cli]");
  const npmDir = npmGlobalPiDir();
  if (npmDir) {
    console.log(`  npm global found: ${npmDir}`);
    const result = run("npm", ["uninstall", "-g", PI_PKG], REPO_ROOT, {
      stdio: "inherit",
      label: "npm uninstall -g",
    });
    if (result.status !== 0) die("npm uninstall -g failed.");
  } else {
    console.log("  no npm global pi");
  }
  if (bunGlobalPiDir()) {
    console.log("  bun global pi already present\n");
    return;
  }
  const result = run("bun", ["install", "-g", PI_PKG], REPO_ROOT, {
    stdio: "inherit",
    label: "bun install -g",
  });
  if (result.status !== 0) die("bun install -g failed.");
  console.log("");
}
