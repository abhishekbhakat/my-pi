/**
 * pi-setup bootstrap entry. Compiled with `bun build --compile` via
 * scripts/dist/build.mjs (`make dist`). The repo snapshot is embedded in the
 * binary; at run time it is extracted to a fixed dir and the standard install
 * flow (scripts/pi.mjs install) runs from there. Must run under bun.
 *
 * Usage:
 *   pi-setup [flags]              extract embedded snapshot, run install
 *   pi-setup --extract-only       extract and exit (testing)
 *   pi-setup update [--check]     swap the extracted snapshot for the latest
 *                                 GitHub release's snapshot.tar.gz asset and
 *                                 re-run install; --check only reports
 *
 * Other flags are forwarded to `pi.mjs install` (e.g. -h HOST).
 * PI_SETUP_EXTRACT_DIR overrides the extraction directory.
 *
 * Version and repo are baked in at compile time as process.env defines
 * (scripts/dist/build.mjs); the run-time PI_SETUP_REPO env var overrides the
 * repo. Updates swap the ~2.5 MB snapshot, never the binary. The installed
 * version is tracked in EXTRACT_DIR/.pi-setup-version.json.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import snapshot from "../dist/snapshot.tar.gz" with { type: "file" };

const EXTRACT_DIR =
  process.env.PI_SETUP_EXTRACT_DIR || path.join(os.homedir(), ".local", "share", "my-pi");
const VERSION_FILE = path.join(EXTRACT_DIR, ".pi-setup-version.json");
const SNAPSHOT_ASSET = "snapshot.tar.gz";
const GITHUB_HEADERS = { "User-Agent": "pi-setup", Accept: "application/vnd.github+json" };
const BINARY_VERSION = process.env.PI_SETUP_VERSION ?? "";
const BINARY_REPO = process.env.PI_SETUP_REPO ?? "";

function countFiles(dir) {
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) count += countFiles(full);
    else if (entry.isFile()) count += 1;
  }
  return count;
}

function prepareExtractDir() {
  fs.rmSync(EXTRACT_DIR, { recursive: true, force: true });
  fs.mkdirSync(EXTRACT_DIR, { recursive: true });
}

function extractTar(tarPath) {
  const result = spawnSync("tar", ["-xzf", tarPath, "-C", EXTRACT_DIR], { stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`pi-setup: tar extraction failed (status ${result.status}).`);
    process.exit(1);
  }
  return countFiles(EXTRACT_DIR);
}

async function extractEmbedded() {
  const bytes = Buffer.from(await Bun.file(snapshot).arrayBuffer());
  prepareExtractDir();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-setup-"));
  const tmp = path.join(tmpDir, "snapshot.tar.gz");
  fs.writeFileSync(tmp, bytes);
  try {
    return extractTar(tmp);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function readInstalledVersion() {
  try {
    const data = JSON.parse(fs.readFileSync(VERSION_FILE, "utf8"));
    return typeof data?.version === "string" ? data : null;
  } catch {
    return null;
  }
}

function writeVersionStore(version, repo) {
  fs.mkdirSync(EXTRACT_DIR, { recursive: true });
  fs.writeFileSync(VERSION_FILE, `${JSON.stringify({ version, repo }, null, 2)}\n`);
}

function findEngine() {
  const bunHome = process.env.BUN_INSTALL || path.join(os.homedir(), ".bun");
  const bunBin = path.join(bunHome, "bin", process.platform === "win32" ? "bun.exe" : "bun");
  const candidates = fs.existsSync(bunBin) ? [bunBin, "node"] : ["bun", "node"];
  for (const cmd of candidates) {
    const probe = spawnSync(cmd, ["--version"], { stdio: "ignore", shell: process.platform === "win32" });
    if (!probe.error && probe.status === 0) return cmd;
  }
  return null;
}

function runInstall(engine, forwardArgs) {
  const bunHome = process.env.BUN_INSTALL || path.join(os.homedir(), ".bun");
  const env = { ...process.env };
  env.PATH = `${path.join(bunHome, "bin")}${path.delimiter}${env.PATH || ""}`;
  console.log(`pi-setup: running install with ${engine}\n`);
  const result = spawnSync(
    engine,
    [path.join(EXTRACT_DIR, "scripts", "pi.mjs"), "install", ...forwardArgs],
    { cwd: EXTRACT_DIR, stdio: "inherit", env, shell: process.platform === "win32" },
  );
  return result.status ?? 1;
}

async function fetchLatestRelease(repo) {
  const url = `https://api.github.com/repos/${repo}/releases/latest`;
  let response;
  try {
    response = await fetch(url, { headers: GITHUB_HEADERS, signal: AbortSignal.timeout(30_000) });
  } catch (error) {
    console.error(`pi-setup: cannot reach ${url} (${error?.message ?? error}).`);
    process.exit(1);
  }
  if (response.status === 404) {
    console.error(`pi-setup: no releases at ${repo} yet. Publish one with \`make release\`.`);
    process.exit(1);
  }
  if (response.status === 403) {
    console.error("pi-setup: GitHub API rate limit hit (unauthenticated: 60 requests/hour per IP). Try again later.");
    process.exit(1);
  }
  if (!response.ok) {
    console.error(`pi-setup: GitHub API error ${response.status} for ${url}.`);
    process.exit(1);
  }
  return await response.json();
}

function snapshotAssetUrl(release) {
  const asset = (release.assets ?? []).find((a) => a?.name === SNAPSHOT_ASSET);
  if (!asset?.browser_download_url) {
    console.error(`pi-setup: release ${release.tag_name} has no ${SNAPSHOT_ASSET} asset.`);
    process.exit(1);
  }
  return asset.browser_download_url;
}

async function update(checkOnly, forwardArgs) {
  const repo = process.env.PI_SETUP_REPO?.trim() || BINARY_REPO.trim();
  if (!repo) {
    console.error("pi-setup: no repo configured. Rebuild the binary from a checkout with a");
    console.error("GitHub origin, or set PI_SETUP_REPO=owner/name.");
    process.exit(1);
  }
  const installed = readInstalledVersion();
  console.log(`pi-setup: repo ${repo}`);
  console.log(`pi-setup: installed ${installed?.version || "unknown"}, binary ${BINARY_VERSION || "unknown"}`);
  const release = await fetchLatestRelease(repo);
  const latest = String(release.tag_name ?? "");
  if (installed?.version && installed.version === latest) {
    console.log("pi-setup: up to date.");
    return 0;
  }
  console.log(`pi-setup: update available${latest ? `: ${installed?.version || "unknown"} -> ${latest}` : ""}.`);
  if (checkOnly) return 0;
  const url = snapshotAssetUrl(release);
  console.log(`pi-setup: downloading ${SNAPSHOT_ASSET} from ${release.tag_name} ...`);
  let response;
  try {
    response = await fetch(url, { headers: GITHUB_HEADERS, signal: AbortSignal.timeout(120_000) });
  } catch (error) {
    console.error(`pi-setup: download failed (${error?.message ?? error}).`);
    process.exit(1);
  }
  if (!response.ok) {
    console.error(`pi-setup: download failed (status ${response.status}).`);
    process.exit(1);
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-setup-update-"));
  const tmp = path.join(tmpDir, SNAPSHOT_ASSET);
  fs.writeFileSync(tmp, Buffer.from(await response.arrayBuffer()));
  try {
    prepareExtractDir();
    const files = extractTar(tmp);
    writeVersionStore(latest, repo);
    console.log(`pi-setup: ${files} files -> ${EXTRACT_DIR}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  const engine = findEngine();
  if (!engine) {
    console.error("pi-setup: no bun or node found. Install bun first:");
    console.error("  curl -fsSL https://bun.sh/install | bash");
    process.exit(1);
  }
  return runInstall(engine, forwardArgs);
}

async function main() {
  const rawArgs = process.argv.slice(2);
  if (rawArgs[0] === "update") {
    const rest = rawArgs.slice(1);
    const checkOnly = rest.includes("--check");
    const forward = rest.filter((arg) => arg !== "--check");
    process.exit(await update(checkOnly, forward));
  }
  const extractOnly = rawArgs.includes("--extract-only");
  const forward = rawArgs.filter((arg) => arg !== "--extract-only");

  console.log("pi-setup: extracting embedded snapshot...");
  const files = await extractEmbedded();
  console.log(`pi-setup: ${files} files -> ${EXTRACT_DIR}`);
  writeVersionStore(BINARY_VERSION, BINARY_REPO);
  if (extractOnly) return;

  const engine = findEngine();
  if (!engine) {
    console.error("pi-setup: no bun or node found. Install bun first:");
    console.error("  curl -fsSL https://bun.sh/install | bash");
    process.exit(1);
  }
  process.exit(runInstall(engine, forward));
}

main().catch((error) => {
  console.error(`pi-setup: ${error?.message ?? error}`);
  process.exit(1);
});
