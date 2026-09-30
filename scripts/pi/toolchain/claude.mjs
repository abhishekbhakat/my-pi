import os from "node:os";
import path from "node:path";
import { exists } from "../fs/read-write.mjs";
import { runTool } from "./run.mjs";

export function probeClaude(env = process.env) {
  const result = runTool("claude", ["--version"], { timeout: 10_000, env });
  if (result.error || result.status !== 0) {
    return { found: false, version: null };
  }
  const version = String(result.stdout ?? "").trim().split(/\r?\n/)[0] || null;
  if (!version) return { found: false, version: null };
  return { found: true, version };
}

export function updateClaude(env = process.env) {
  const attempts = [];
  const claudeUp = runTool("claude", ["update"], {
    timeout: 180_000,
    stdio: ["ignore", "inherit", "inherit"],
    env,
  });
  if (!claudeUp.error && claudeUp.status === 0) {
    return { path: "claude update", ok: true, detail: "ok" };
  }
  attempts.push(`claude update exited ${claudeUp.status ?? "error"}`);

  const brewList = runTool("brew", ["list", "--cask", "claude-code"], { timeout: 30_000, env });
  if (!brewList.error && brewList.status === 0) {
    const brewUp = runTool("brew", ["upgrade", "--cask", "claude-code"], {
      timeout: 180_000,
      stdio: ["ignore", "inherit", "inherit"],
      env,
    });
    if (!brewUp.error && brewUp.status === 0) {
      return { path: "brew", ok: true, detail: "ok" };
    }
    attempts.push(`brew upgrade exited ${brewUp.status ?? "error"}`);
  }

  const npmLs = runTool("npm", ["ls", "-g", "--depth=0", "@anthropic-ai/claude-code"], {
    timeout: 30_000,
    env,
  });
  if (!npmLs.error && npmLs.status === 0) {
    const npmInstall = runTool(
      "npm",
      ["install", "-g", "@anthropic-ai/claude-code@latest"],
      { timeout: 180_000, stdio: ["ignore", "inherit", "inherit"], env },
    );
    if (!npmInstall.error && npmInstall.status === 0) {
      return { path: "npm", ok: true, detail: "ok" };
    }
    attempts.push(`npm install exited ${npmInstall.status ?? "error"}`);
  }

  const bunHome = env.BUN_INSTALL || path.join(env.HOME || os.homedir(), ".bun");
  const bunPkg = path.join(bunHome, "install", "global", "node_modules", "@anthropic-ai", "claude-code", "package.json");
  if (exists(bunPkg)) {
    const bunAdd = runTool("bun", ["add", "-g", "@anthropic-ai/claude-code@latest"], {
      timeout: 180_000,
      stdio: ["ignore", "inherit", "inherit"],
      env,
    });
    if (!bunAdd.error && bunAdd.status === 0) {
      return { path: "bun", ok: true, detail: "ok" };
    }
    attempts.push(`bun add exited ${bunAdd.status ?? "error"}`);
  }

  const suffix = attempts.length === 1 ? "; no brew/npm/bun install detected" : "";
  return {
    path: null,
    ok: false,
    detail: `${attempts.join(";")}${suffix}`,
  };
}
