import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SetupAbort } from "../errors.mjs";
import { exists, writeAtomic } from "../fs/read-write.mjs";
import { copyDirReplace, rmTree } from "../fs/tree.mjs";
import { PROFILE_PATCH, REPO_AGENT, REPO_ROOT } from "../paths.mjs";
import { gitAt } from "./branch-gate.mjs";

const AGENT_PREFIX = ".pi/agent";

function gitEnv(indexFile) {
  return { ...process.env, GIT_INDEX_FILE: indexFile };
}

function runGit(root, args, env) {
  return spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Refuse setup when tracked .pi/agent files are dirty (auth.json ignored). */
export function assertCleanAgentTree(root = REPO_ROOT) {
  const status = gitAt(root, ["status", "--porcelain", "-uall", "--", AGENT_PREFIX]);
  if (status.status !== 0) {
    throw new SetupAbort(`git status failed: ${String(status.stderr ?? "").trim() || "unknown"}`);
  }
  const dirty = String(status.stdout ?? "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .filter((line) => {
      const file = line.slice(3).trim();
      const norm = file.replace(/^\.\//, "");
      return norm !== `${AGENT_PREFIX}/auth.json` && !norm.endsWith("/auth.json");
    });
  if (dirty.length > 0) {
    throw new SetupAbort(
      `.pi/agent has uncommitted tracked changes; commit or stash them first so userprofile.patch only contains your profile.\n${dirty.slice(0, 8).join("\n")}`,
    );
  }
}

export function headSha(root = REPO_ROOT) {
  const rev = gitAt(root, ["rev-parse", "HEAD"]);
  if (rev.status !== 0) throw new SetupAbort("cannot resolve HEAD");
  return String(rev.stdout ?? "").trim();
}

function currentBranch(root = REPO_ROOT) {
  const sym = gitAt(root, ["symbolic-ref", "--quiet", "HEAD"]);
  if (sym.status !== 0) return null;
  const full = String(sym.stdout ?? "").trim();
  return full.startsWith("refs/heads/") ? full.slice("refs/heads/".length) : null;
}

/**
 * Validate repo and clean agent tree. No branch create/delete.
 * @returns {{ baseSha: string, branch: string | null }}
 */
export function setupRepoGate(root = REPO_ROOT) {
  const top = gitAt(root, ["rev-parse", "--show-toplevel"]);
  if (top.error || top.status !== 0) throw new SetupAbort(`not a git repository root: ${root}`);
  let topReal;
  let rootReal;
  try {
    topReal = fs.realpathSync(String(top.stdout ?? "").trim());
    rootReal = fs.realpathSync(root);
  } catch {
    throw new SetupAbort(`not a git repository root: ${root}`);
  }
  if (topReal !== rootReal) throw new SetupAbort(`not a git repository root: ${root}`);
  assertCleanAgentTree(root);
  return { baseSha: headSha(root), branch: currentBranch(root) };
}

function scanSecrets(patchText, secrets) {
  for (const secret of secrets) {
    if (!secret || secret.length < 8) continue;
    if (patchText.includes(secret)) {
      throw new SetupAbort("refusing to write userprofile.patch: an API key would be included. Nothing written.");
    }
  }
}

/**
 * Diff working-tree .pi/agent against baseSha into /userprofile.patch.
 * auth.json is gitignored so it stays out. Restores nothing by itself.
 */
export function writeProfilePatch({
  root = REPO_ROOT,
  baseSha,
  secrets = [],
  branch = null,
  patchPath = PROFILE_PATCH,
} = {}) {
  if (!baseSha) throw new SetupAbort("writeProfilePatch: baseSha required");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "my-pi-profile-"));
  const indexFile = path.join(tmpDir, "index");
  try {
    const env = gitEnv(indexFile);
    const read = runGit(root, ["read-tree", baseSha], env);
    if (read.status !== 0) {
      throw new SetupAbort(`git read-tree failed: ${String(read.stderr ?? "").trim()}`);
    }
    // Never put auth.json in the patch (gitignored in this repo; still exclude explicitly).
    const add = runGit(
      root,
      ["add", "-A", "--", AGENT_PREFIX, `:(exclude)${AGENT_PREFIX}/auth.json`],
      env,
    );
    if (add.status !== 0) {
      throw new SetupAbort(`git add failed: ${String(add.stderr ?? "").trim()}`);
    }
    runGit(root, ["rm", "-f", "--cached", "--ignore-unmatch", "--", `${AGENT_PREFIX}/auth.json`], env);
    const diff = runGit(root, ["diff", "--cached", "--binary", baseSha, "--", AGENT_PREFIX], env);
    if (diff.status !== 0) {
      throw new SetupAbort(`git diff failed: ${String(diff.stderr ?? "").trim()}`);
    }
    let body = String(diff.stdout ?? "");
    if (body.includes(`${AGENT_PREFIX}/auth.json`)) {
      throw new SetupAbort("refusing to write userprofile.patch: auth.json would be included. Nothing written.");
    }
    const header = [
      "# my-pi userprofile.patch",
      `# base: ${baseSha}`,
      `# branch: ${branch ?? "(detached)"}`,
      `# created: ${new Date().toISOString()}`,
      "# Apply via make install (temp staging). Do not commit. Secrets never belong here.",
      "",
    ].join("\n");
    const text = `${header}${body}`;
    scanSecrets(text, secrets);
    writeAtomic(patchPath, text);
    const hunks = (body.match(/^diff --git /gm) || []).length;
    return { path: patchPath, hunks, bytes: text.length };
  } finally {
    rmTree(tmpDir);
  }
}

/** Put tracked .pi/agent files back to HEAD. Leaves untracked auth.json and userprofile.patch. */
export function restoreAgentTracked(root = REPO_ROOT) {
  const result = gitAt(root, ["restore", "--source=HEAD", "--worktree", "--", AGENT_PREFIX]);
  if (result.status !== 0) {
    // Older git: checkout --
    const fallback = gitAt(root, ["checkout", "HEAD", "--", AGENT_PREFIX]);
    if (fallback.status !== 0) {
      throw new SetupAbort(
        `failed to restore tracked .pi/agent to HEAD: ${String(result.stderr || fallback.stderr || "").trim()}`,
      );
    }
  }
}

function applyInTree(cwd, patchPath) {
  const check = spawnSync("git", ["apply", "--check", patchPath], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (check.status === 0) {
    const apply = spawnSync("git", ["apply", patchPath], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (apply.status !== 0) {
      throw new SetupAbort(
        `userprofile.patch failed to apply. Nothing was installed to ~/.pi. Run: make setup\n${String(apply.stderr ?? "").trim()}`,
      );
    }
    return "applied";
  }
  const reverse = spawnSync("git", ["apply", "--reverse", "--check", patchPath], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (reverse.status === 0) return "already";
  const baseLine = fs
    .readFileSync(patchPath, "utf8")
    .split("\n")
    .find((line) => line.startsWith("# base:"));
  const base = baseLine ? baseLine.slice("# base:".length).trim() : "(unknown)";
  const head = (() => {
    try {
      return headSha(REPO_ROOT);
    } catch {
      return "(unknown)";
    }
  })();
  throw new SetupAbort(
    `userprofile.patch no longer applies to this checkout (made from ${base}, HEAD is now ${head}). Nothing was installed to ~/.pi. Run: make setup`,
  );
}

/**
 * Copy repo agent into a temp repo-root layout and apply userprofile.patch there.
 * @returns {{ dir: string, agentDir: string, status: "applied"|"already"|"none", cleanup: () => void }}
 */
export function stageAgentWithProfile({
  repoAgent = REPO_AGENT,
  patchPath = PROFILE_PATCH,
  noProfile = false,
  root = REPO_ROOT,
} = {}) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "my-pi-install-"));
  const agentDir = path.join(tmpRoot, ".pi", "agent");
  fs.mkdirSync(path.dirname(agentDir), { recursive: true });
  const cleanup = () => rmTree(tmpRoot);
  try {
    copyDirReplace(repoAgent, agentDir);
    if (noProfile) {
      console.log("userprofile.patch: skipped (--no-profile)");
      return { dir: tmpRoot, agentDir, status: "none", cleanup };
    }
    if (!exists(patchPath)) {
      console.log("no userprofile.patch; installing repo .pi/agent as-is");
      return { dir: tmpRoot, agentDir, status: "none", cleanup };
    }
    const raw = fs.readFileSync(patchPath, "utf8");
    if (!raw.trim() || !/^diff --git /m.test(raw)) {
      if (!raw.trim()) {
        cleanup();
        throw new SetupAbort("userprofile.patch is empty or malformed. Delete it or run: make setup");
      }
      console.log("userprofile.patch has no file hunks; installing repo .pi/agent as-is");
      return { dir: tmpRoot, agentDir, status: "none", cleanup };
    }
    // Patch paths are .pi/agent/... relative to repo root.
    const status = applyInTree(tmpRoot, patchPath);
    if (status === "already") console.log("userprofile.patch already applied; skipping");
    else console.log(`userprofile.patch applied (base from patch header; cwd staging)`);
    return { dir: tmpRoot, agentDir, status, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

export function collectSecretsFromStaged(staged) {
  const secrets = [];
  if (staged?.apiKeys) {
    for (const key of staged.apiKeys.values()) {
      if (typeof key === "string" && key.trim()) secrets.push(key.trim());
    }
  }
  return secrets;
}
