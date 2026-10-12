import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { REPO_ROOT } from "../paths.mjs";
import { SetupAbort } from "../errors.mjs";

const PROTECTED_BRANCHES = new Set(["main", "master"]);
const AGENT_PREFIX = ".pi/agent";

export function gitAt(root, args) {
  try {
    return spawnSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    return { status: 1, stdout: "", stderr: String(error?.message ?? error), error };
  }
}

/** Auto branch name pi-install-<ddmmyyyy>, suffixed -2, -3... if taken. */
export function autoBranchName(root) {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = String(now.getFullYear());
  const base = `pi-install-${dd}${mm}${yyyy}`;
  let name = base;
  let n = 2;
  while (gitAt(root ?? process.cwd(), ["show-ref", "--verify", "--quiet", `refs/heads/${name}`]).status === 0) {
    name = `${base}-${n}`;
    n += 1;
  }
  return name;
}

function branchHint(branch) {
  const where = branch === null ? "detached HEAD" : `branch ${branch}`;
  return [
    `setup refuses to mutate on ${where}. Create a local branch first:`,
    `  make setup ARGS="--create-branch"            (auto: pi-install-<ddmmyyyy>)`,
    `  make setup ARGS="--create-branch setup/local-<name>"`,
    `  node scripts/pi.mjs setup --create-branch setup/local-<name>`,
  ].join("\n");
}

/** Phase 0 gate. Throws SetupAbort. Only write is optional checkout -b.
 * createBranch: string name | "auto" (pi-install-<ddmmyyyy>) | null (refuse on protected). */
export function branchGate(root, createBranch) {
  const top = gitAt(root, ["rev-parse", "--show-toplevel"]);
  if (top.error || top.status !== 0) {
    throw new SetupAbort(`not a git repository root: ${root}`);
  }
  let topReal;
  let rootReal;
  try {
    topReal = fs.realpathSync(String(top.stdout ?? "").trim());
    rootReal = fs.realpathSync(root);
  } catch {
    throw new SetupAbort(`not a git repository root: ${root}`);
  }
  if (topReal !== rootReal) {
    throw new SetupAbort(`not a git repository root: ${root}`);
  }

  const sym = gitAt(root, ["symbolic-ref", "--quiet", "HEAD"]);
  const full = sym.status === 0 ? String(sym.stdout ?? "").trim() : "";
  const branch = full.startsWith("refs/heads/") ? full.slice("refs/heads/".length) : null;

  let name = createBranch;
  if (name === "auto") {
    if (branch !== null && !PROTECTED_BRANCHES.has(branch)) {
      return { branch, created: false };
    }
    name = autoBranchName(root);
  }

  if (!name) {
    if (branch === null || PROTECTED_BRANCHES.has(branch)) {
      throw new SetupAbort(branchHint(branch));
    }
    return { branch, created: false };
  }

  if (name === "HEAD" || PROTECTED_BRANCHES.has(name)) {
    throw new SetupAbort(`invalid branch name: ${name}`);
  }
  const fmt = gitAt(root, ["check-ref-format", "--branch", name]);
  const fmtOut = String(fmt.stdout ?? "").trim();
  if (fmt.status !== 0 || fmtOut !== name) {
    throw new SetupAbort(`invalid branch name: ${name}`);
  }
  const exists = gitAt(root, ["show-ref", "--verify", "--quiet", `refs/heads/${name}`]);
  if (exists.status === 0) {
    throw new SetupAbort(`branch already exists: ${name}`);
  }
  const co = gitAt(root, ["checkout", "-b", name]);
  if (co.status !== 0) {
    const detail = String(co.stderr ?? "").trim() || "checkout failed";
    throw new SetupAbort(`git checkout -b ${name} failed: ${detail}`);
  }
  return { branch: name, created: true };
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
      `.pi/agent has uncommitted tracked changes; commit or stash them first so userprofile.json only contains your profile.\n${dirty.slice(0, 8).join("\n")}`,
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

/** Put tracked .pi/agent files back to HEAD. Leaves untracked auth.json and userprofile.json. */
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
