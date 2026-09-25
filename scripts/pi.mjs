#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
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
const INSTALL_ROOT = ["settings.json", "models.json", "SYSTEM.md"];
const SYNC_ROOT = [
  "settings.json", "models.json", "models-store.json",
  "SYSTEM.md",
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

function parseJsonObjectFile(filePath, { redact = false } = {}) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return { ok: false, reason: redact ? "invalid JSON" : `invalid JSON: ${error.message}` };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, reason: "must be a JSON object" };
  }
  return { ok: true, data };
}

function readJsonObject(filePath, fallback) {
  if (!exists(filePath)) {
    if (fallback !== undefined) return fallback;
    die(`missing ${filePath}`);
  }
  const parsed = parseJsonObjectFile(filePath);
  if (!parsed.ok) die(`${filePath} ${parsed.reason}`);
  return parsed.data;
}

export function loadSetupInputs(agentDir) {
  const read = (name, { required, redact }) => {
    const p = path.join(agentDir, name);
    if (!exists(p)) {
      if (required) throw new SetupAbort(`missing ${p}`);
      return {};
    }
    const r = parseJsonObjectFile(p, { redact });
    if (!r.ok) throw new SetupAbort(`${p}: ${r.reason}`);
    return r.data;
  };
  const settings = read("settings.json", { required: true, redact: false });
  const models = read("models.json", { required: false, redact: true });
  const auth = read("auth.json", { required: false, redact: true });
  if (!Array.isArray(settings.enabledModels) || !settings.enabledModels.every((x) => typeof x === "string")) {
    throw new SetupAbort("settings.json enabledModels must be an array of strings");
  }
  const settingsPath = path.join(agentDir, "settings.json");
  const settingsText = fs.readFileSync(settingsPath, "utf8");
  return { settings, models, auth, settingsText };
}

function writeAtomic(dest, contents, mode) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const dir = path.dirname(dest);
  const tmp = path.join(dir, `.${path.basename(dest)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(tmp, contents, { mode: mode ?? 0o666, flag: "wx" });
    if (mode && process.platform !== "win32") fs.chmodSync(tmp, mode);
    try {
      fs.renameSync(tmp, dest);
    } catch {
      fs.copyFileSync(tmp, dest);
      if (mode && process.platform !== "win32") fs.chmodSync(dest, mode);
    }
    if (mode && process.platform !== "win32") {
      try {
        fs.chmodSync(dest, mode);
      } catch {
        // best-effort on platforms that already applied mode via rename
      }
    }
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function isOauthEntry(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && value.type === "oauth");
}

export const PROVIDER_PRIORITY = [
  "google",
  "claude-code-cli",
  "openai-codex",
  "openrouter",
  "kimi-coding",
  "grok-cli",
];
// openai-codex is oauth in auth but classified as "codex" (Phase 1), so omit here.
export const OAUTH_PROVIDERS = new Set(["kimi-coding", "grok-cli"]);
export const CAPABILITY_PREFERRED = {
  timeline: "google/gemini-3.8-flash",
  scout: "google/gemini-3.8-flash",
  coach: "claude-code-cli/opus",
  reviewer: "claude-code-cli/opus",
};

function providerOf(ref) {
  if (typeof ref !== "string") return "";
  const slash = ref.indexOf("/");
  if (slash <= 0) return "";
  return ref.slice(0, slash);
}

function modelIdOf(ref) {
  if (typeof ref !== "string") return "";
  const slash = ref.indexOf("/");
  if (slash <= 0) return "";
  return ref.slice(slash + 1);
}

function firstByPriority(keptModels, orderedProviders) {
  const kept = Array.isArray(keptModels) ? keptModels : [];
  const order = Array.isArray(orderedProviders) ? orderedProviders : [];
  for (const provider of order) {
    for (const ref of kept) {
      if (providerOf(ref) === provider) return ref;
    }
  }
  return null;
}

/** Unique providers: priority first (only if present), then first-seen. */
export function orderProviders(enabledModels) {
  const list = Array.isArray(enabledModels) ? enabledModels : [];
  const seen = new Set();
  const firstSeen = [];
  for (const ref of list) {
    const provider = providerOf(ref);
    if (!provider || seen.has(provider)) continue;
    seen.add(provider);
    firstSeen.push(provider);
  }
  const present = new Set(firstSeen);
  const ordered = [];
  for (const provider of PROVIDER_PRIORITY) {
    if (present.has(provider)) ordered.push(provider);
  }
  for (const provider of firstSeen) {
    if (!PROVIDER_PRIORITY.includes(provider)) ordered.push(provider);
  }
  return ordered;
}

/** @returns {"cli"|"codex"|"oauth"|"apikey"} */
export function classifyProvider(provider, auth = {}) {
  if (provider === "claude-code-cli") return "cli";
  if (provider === "openai-codex") return "codex";
  if (OAUTH_PROVIDERS.has(provider) || isOauthEntry(auth?.[provider])) return "oauth";
  return "apikey";
}

export function providerBaseUrl(provider, models) {
  const url = models?.providers?.[provider]?.baseUrl;
  return typeof url === "string" ? url : null;
}

export function filterEnabledModels(enabledModels, enabledProviders) {
  const list = Array.isArray(enabledModels) ? enabledModels : [];
  const allowed = enabledProviders instanceof Set
    ? enabledProviders
    : new Set(Array.isArray(enabledProviders) ? enabledProviders : []);
  return list.filter((ref) => allowed.has(providerOf(ref)));
}

export function resolveDefaults(settings, keptModels, orderedProviders) {
  const currentProvider = typeof settings?.defaultProvider === "string" ? settings.defaultProvider : null;
  const currentModel = typeof settings?.defaultModel === "string" ? settings.defaultModel : null;
  if (!currentProvider) {
    return { defaultProvider: currentProvider, defaultModel: currentModel, changed: false };
  }
  const kept = Array.isArray(keptModels) ? keptModels : [];
  const keptProviders = new Set(kept.map(providerOf).filter(Boolean));
  if (keptProviders.has(currentProvider)) {
    return { defaultProvider: currentProvider, defaultModel: currentModel, changed: false };
  }
  const pick = firstByPriority(kept, orderedProviders);
  if (!pick) {
    return { defaultProvider: null, defaultModel: null, changed: true };
  }
  return {
    defaultProvider: providerOf(pick),
    defaultModel: modelIdOf(pick),
    changed: true,
  };
}

function hasApiKey(entry) {
  return Boolean(
    entry
    && typeof entry === "object"
    && !Array.isArray(entry)
    && entry.type !== "oauth"
    && typeof entry.key === "string"
    && entry.key.trim() !== "",
  );
}

export function describeStaged(staged, order) {
  const enabled = order.filter((p) => staged.enabled.has(p));
  const newKeys = order.filter((p) => staged.apiKeys.has(p));
  const pending = staged.oauthPending.length ? staged.oauthPending.join(",") : "(none)";
  const skipped = staged.skipped.length
    ? staged.skipped.map((s) => `${s.provider}(${s.reason})`).join(",")
    : "(none)";
  return `Phase 2: enabled=${enabled.join(",") || "(none)"}; new-keys=${newKeys.join(",") || "(none)"}; oauth-pending=${pending}; skipped=${skipped}`;
}

export function planSettings(settings, staged, order) {
  const before = Array.isArray(settings?.enabledModels) ? settings.enabledModels : [];
  const bare = before.filter((ref) => typeof ref === "string" && !ref.includes("/"));
  const kept = filterEnabledModels(before, staged.enabled);
  if (kept.length === 0) {
    throw new SetupAbort("enable at least one provider");
  }
  const defaults = resolveDefaults(settings, kept, order);
  const next = { ...settings, enabledModels: kept };
  if (defaults.changed) {
    next.defaultProvider = defaults.defaultProvider;
    next.defaultModel = defaults.defaultModel;
  }
  const droppedProviders = order.filter((p) => !staged.enabled.has(p));
  return {
    next,
    kept,
    bare,
    droppedProviders,
    defaults,
    changed: kept.length !== before.length || defaults.changed || bare.length > 0,
  };
}

const CAP_DIR = ["extensions", "capability-tools", "capabilities"];
const CAP_ROLE_BY_TOOL = {
  reasoning_coach: "coach",
  patch_reviewer: "reviewer",
  code_scout: "scout",
  commit_message: "scout",
};
const CAP_TARGET_RE = /^[A-Za-z0-9._-]+\/[^\s"'\\`$]+$/;

function detectEol(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function normalizeToolName(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function parseFrontmatterBlock(text) {
  const eol = detectEol(text);
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") throw new SetupAbort("capability file missing frontmatter start");
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i] === "---") {
      end = i;
      break;
    }
  }
  if (end < 0) throw new SetupAbort("capability file missing frontmatter end");
  const fmLines = lines.slice(1, end);
  /** @type {Record<string, string>} */
  const fm = {};
  /** @type {Record<string, number>} */
  const counts = {};
  for (const line of fmLines) {
    const m = line.match(/^([A-Za-z][A-Za-z0-9_]*)(\s*:\s*)(.*)$/);
    if (!m) continue;
    const key = m[1];
    counts[key] = (counts[key] ?? 0) + 1;
    fm[key] = m[3].trim();
  }
  return { eol, lines, end, fm, counts };
}

function assertUniqueKeys(pathLabel, counts, keys) {
  for (const key of keys) {
    if ((counts[key] ?? 0) > 1) throw new SetupAbort(`${pathLabel}: duplicate frontmatter key ${key}`);
  }
}

function replaceQuotedTimeline(text, pathLabel, target) {
  const re = /^(\s*timelineModel:\s*")([^"\n]*)(",?\s*)$/gm;
  const matches = [...text.matchAll(re)];
  if (matches.length !== 1) {
    throw new SetupAbort(`${pathLabel}: expected exactly one quoted timelineModel literal, found ${matches.length}`);
  }
  const after = text.replace(re, `$1${target}$3`);
  return after;
}

export function loadCapabilitySources(agentDir) {
  const capsDir = path.join(agentDir, ...CAP_DIR);
  if (!exists(capsDir)) throw new SetupAbort(`missing ${capsDir}`);
  const names = fs.readdirSync(capsDir).filter((n) => n.endsWith(".md") && !n.startsWith(".")).sort();
  const caps = names.map((name) => {
    const filePath = path.join(capsDir, name);
    const text = fs.readFileSync(filePath, "utf8");
    let parsed;
    try {
      parsed = parseFrontmatterBlock(text);
    } catch (error) {
      if (error instanceof SetupAbort) throw new SetupAbort(`${filePath}: ${error.message}`);
      throw error;
    }
    assertUniqueKeys(filePath, parsed.counts, ["model", "timelineModel", "tool"]);
    return {
      path: filePath,
      rel: path.posix.join(".pi/agent", ...CAP_DIR, name),
      text,
      eol: parsed.eol,
      fm: parsed.fm,
      lines: parsed.lines,
      end: parsed.end,
    };
  });

  const defPath = path.join(agentDir, "extensions", "capability-tools", "definitions.ts");
  const boolPath = path.join(agentDir, "extensions", "capability-tools", "booleanGuy.ts");
  if (!exists(defPath)) throw new SetupAbort(`missing ${defPath}`);
  if (!exists(boolPath)) throw new SetupAbort(`missing ${boolPath}`);
  const definitions = { path: defPath, text: fs.readFileSync(defPath, "utf8") };
  const booleanGuy = { path: boolPath, text: fs.readFileSync(boolPath, "utf8") };
  // Validate anchors early.
  replaceQuotedTimeline(definitions.text, defPath, "google/gemini-3.8-flash");
  replaceQuotedTimeline(booleanGuy.text, boolPath, "google/gemini-3.8-flash");
  return { caps, definitions, booleanGuy };
}

function prioritySortedKept(kept, order) {
  const out = [];
  for (const provider of order) {
    for (const ref of kept) {
      if (providerOf(ref) === provider && !out.includes(ref)) out.push(ref);
    }
  }
  for (const ref of kept) {
    if (!out.includes(ref)) out.push(ref);
  }
  return out;
}

export async function resolveCapabilityTargets({ kept, order, resolved, prompter, log = console.log }) {
  const choices = prioritySortedKept(kept, order);
  if (!choices.length) throw new SetupAbort("enable at least one provider");
  const roles = ["timeline", "scout", "coach", "reviewer"];
  /** @type {Record<string, string>} */
  const targets = {};
  const need = [];
  for (const role of roles) {
    const info = resolved[role];
    if (info.ok) targets[role] = info.preferred;
    else need.push(role);
  }
  if (!need.length) return targets;

  if (choices.length === 1) {
    log(`Phase 4: only one enabled model; using ${choices[0]} for ${need.join(",")}`);
    for (const role of need) targets[role] = choices[0];
    return targets;
  }

  log("Phase 4: preferred capability models unavailable; pick replacements.");
  need.forEach((role, idx) => {
    // printed below per ask
    void idx;
  });
  let printed = false;
  for (const role of need) {
    const label = `${role === "scout" ? "scout/commit" : role} (preferred ${resolved[role].preferred} not enabled)`;
    const idx = await prompter.askPick(label, choices, 0, { printChoices: !printed });
    printed = true;
    targets[role] = choices[idx];
  }
  return targets;
}

function setFrontmatterValue(text, key, target) {
  const parsed = parseFrontmatterBlock(text);
  const lines = parsed.lines.slice();
  let found = false;
  let changed = false;
  for (let i = 1; i < parsed.end; i += 1) {
    const m = lines[i].match(new RegExp(`^(${key})(\\s*:\\s*)(.*)$`));
    if (!m) continue;
    found = true;
    if (m[3].trim() === target) continue;
    lines[i] = `${m[1]}${m[2]}${target}`;
    changed = true;
  }
  if (!found || !changed) return null;
  let out = lines.join(parsed.eol);
  if (text.endsWith("\r\n")) {
    if (!out.endsWith("\r\n")) out += "\r\n";
  } else if (text.endsWith("\n")) {
    if (!out.endsWith("\n")) out += "\n";
  }
  return out;
}

export function planCapabilityEdits(sources, targets) {
  for (const value of Object.values(targets)) {
    if (!CAP_TARGET_RE.test(value)) throw new SetupAbort(`invalid capability model ref: ${value}`);
  }
  /** @type {{ path: string, before: string, after: string, changes: { key: string, from: string, to: string }[] }[]} */
  const edits = [];

  for (const cap of sources.caps) {
    const tool = normalizeToolName(cap.fm.tool);
    const role = CAP_ROLE_BY_TOOL[tool];
    const changes = [];
    let afterText = cap.text;

    if (role && targets[role] && Object.hasOwn(cap.fm, "model")) {
      const next = setFrontmatterValue(afterText, "model", targets[role]);
      if (next) {
        changes.push({ key: "model", from: cap.fm.model, to: targets[role] });
        afterText = next;
      }
    }

    if (Object.hasOwn(cap.fm, "timelineModel") && targets.timeline) {
      const next = setFrontmatterValue(afterText, "timelineModel", targets.timeline);
      if (next) {
        changes.push({ key: "timelineModel", from: cap.fm.timelineModel, to: targets.timeline });
        afterText = next;
      }
    }

    if (changes.length) {
      edits.push({ path: cap.path, before: cap.text, after: afterText, changes });
    }
  }

  if (targets.timeline) {
    const defAfter = replaceQuotedTimeline(sources.definitions.text, sources.definitions.path, targets.timeline);
    if (defAfter !== sources.definitions.text) {
      edits.push({
        path: sources.definitions.path,
        before: sources.definitions.text,
        after: defAfter,
        changes: [{ key: "timelineModel", from: "(definitions.ts)", to: targets.timeline }],
      });
    }
    const boolAfter = replaceQuotedTimeline(sources.booleanGuy.text, sources.booleanGuy.path, targets.timeline);
    if (boolAfter !== sources.booleanGuy.text) {
      edits.push({
        path: sources.booleanGuy.path,
        before: sources.booleanGuy.text,
        after: boolAfter,
        changes: [{ key: "timelineModel", from: "(booleanGuy.ts)", to: targets.timeline }],
      });
    }
  }

  return edits;
}

export function describeCapabilityPlan(targets, edits) {
  return `Phase 4: timeline=${targets.timeline}; scout/commit=${targets.scout}; coach=${targets.coach}; reviewer=${targets.reviewer}; files to edit: ${edits.length}`;
}

const PROVIDER_ID_RE = /^[A-Za-z0-9._-]+$/;

function mergeStagedKeys(current, apiKeys) {
  const entries = new Map(Object.entries(current ?? {}));
  const updated = [];
  for (const [provider, key] of apiKeys) {
    if (!PROVIDER_ID_RE.test(provider)) throw new SetupAbort(`invalid provider id: ${provider}`);
    const prev = entries.get(provider);
    if (isOauthEntry(prev)) throw new SetupAbort(`${provider}: refusing to overwrite oauth entry`);
    const base = prev && typeof prev === "object" && !Array.isArray(prev) ? prev : {};
    entries.set(provider, { ...base, type: "api_key", key });
    updated.push(provider);
  }
  return { merged: Object.fromEntries(entries), updated };
}

function assertUnderAgentDir(agentDir, filePath) {
  const rel = path.relative(agentDir, filePath);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new SetupAbort(`refusing write outside agent dir: ${filePath}`);
  }
  return rel.split(path.sep).join("/");
}

export function persistSetup({ agentDir, staged, settingsPlan, settingsText, capEdits }) {
  /** @type {{ path: string, contents: string, mode?: number, rel: string }[]} */
  const writes = [];
  const unchanged = [];
  const authKeys = [];

  const authPath = path.join(agentDir, "auth.json");
  let authText = null;
  if (staged.apiKeys.size > 0) {
    let current = {};
    if (exists(authPath)) {
      authText = fs.readFileSync(authPath, "utf8");
      const parsed = parseJsonObjectFile(authPath, { redact: true });
      if (!parsed.ok) throw new SetupAbort(`${authPath}: ${parsed.reason}`);
      current = parsed.data;
    }
    const { merged, updated } = mergeStagedKeys(current, staged.apiKeys);
    authKeys.push(...updated);
    const contents = `${JSON.stringify(merged, null, 2)}\n`;
    if (contents !== authText) {
      writes.push({ path: authPath, contents, mode: 0o600, rel: ".pi/agent/auth.json" });
    } else {
      unchanged.push(".pi/agent/auth.json");
    }
  }

  const settingsPath = path.join(agentDir, "settings.json");
  const liveSettingsText = fs.readFileSync(settingsPath, "utf8");
  if (liveSettingsText !== settingsText) {
    throw new SetupAbort("settings.json changed during setup; re-run");
  }
  const settingsContents = `${JSON.stringify(settingsPlan.next, null, 2)}\n`;
  if (settingsContents !== liveSettingsText) {
    writes.push({
      path: settingsPath,
      contents: settingsContents,
      rel: ".pi/agent/settings.json",
    });
  } else {
    unchanged.push(".pi/agent/settings.json");
  }

  for (const edit of capEdits) {
    const rel = assertUnderAgentDir(agentDir, edit.path);
    const live = fs.readFileSync(edit.path, "utf8");
    if (live !== edit.before) {
      throw new SetupAbort(`${rel} changed since plan; re-run setup`);
    }
    if (live === edit.after) {
      unchanged.push(`.pi/agent/${rel}`);
      continue;
    }
    writes.push({ path: edit.path, contents: edit.after, rel: `.pi/agent/${rel}` });
  }

  for (const w of writes) writeAtomic(w.path, w.contents, w.mode);
  return {
    written: writes.map((w) => w.rel),
    unchanged,
    authKeys,
  };
}

function describePersistSummary({ gate, staged, order, capTargets, report }) {
  const enabled = order.filter((p) => staged.enabled.has(p)).join(",") || "(none)";
  const skipped = staged.skipped.length
    ? staged.skipped.map((s) => `${s.provider}(${s.reason})`).join(",")
    : "(none)";
  const pending = staged.oauthPending.length ? staged.oauthPending.join(",") : "(none)";
  const authLine = report.authKeys.length
    ? `auth.json: updated keys for ${report.authKeys.join(",")}`
    : "auth.json: unchanged";
  return [
    `Setup complete on branch ${gate.branch}.`,
    `  enabled: ${enabled}`,
    `  skipped: ${skipped}`,
    `  oauth-pending: ${pending}`,
    `  capabilities: timeline=${capTargets.timeline}; scout/commit=${capTargets.scout}; coach=${capTargets.coach}; reviewer=${capTargets.reviewer}`,
    `  ${authLine}`,
    `  written: ${report.written.join(", ") || "(none)"}`,
    "  Review with git diff; auth.json is gitignored. Do not commit secrets.",
  ].join("\n");
}

function printPostSetupHints(staged, ranInstall) {
  console.log("Run /reload or /restart inside pi to pick up changes.");
  for (const provider of staged.oauthPending) {
    console.log(`Run /login ${provider} inside pi.`);
  }
  if (!ranInstall) console.log("Run make install to apply repo config to ~/.pi.");
}

export function describeSettingsPlan(plan, settings) {
  const beforeCount = Array.isArray(settings?.enabledModels) ? settings.enabledModels.length : 0;
  const lines = [
    `Phase 3: enabledModels ${beforeCount} -> ${plan.kept.length}; dropped providers: ${plan.droppedProviders.join(",") || "(none)"}`,
  ];
  if (plan.bare.length) {
    lines.push(`Phase 3: WARNING dropping entries without provider: ${plan.bare.join(",")}`);
  }
  const prevP = settings?.defaultProvider;
  const prevM = settings?.defaultModel;
  if (!prevP) {
    lines.push("Phase 3: default (unset)");
  } else if (!plan.defaults.changed) {
    lines.push(`Phase 3: default unchanged (${prevP}/${prevM})`);
  } else {
    lines.push(
      `Phase 3: default ${prevP}/${prevM} -> ${plan.defaults.defaultProvider}/${plan.defaults.defaultModel}`,
    );
  }
  return lines.join("\n");
}

export async function collectProviders({
  order,
  auth,
  models,
  wantClaude,
  wantCodex,
  prompter,
  log = console.log,
}) {
  /** @type {{ enabled: Set<string>, apiKeys: Map<string, string>, oauthPending: string[], skipped: { provider: string, reason: string }[] }} */
  const staged = {
    enabled: new Set(),
    apiKeys: new Map(),
    oauthPending: [],
    skipped: [],
  };

  const markPending = (provider) => {
    if (!isOauthEntry(auth?.[provider])) staged.oauthPending.push(provider);
  };

  for (const provider of order) {
    const kind = classifyProvider(provider, auth);
    if (kind === "cli") {
      if (wantClaude) staged.enabled.add(provider);
      else staged.skipped.push({ provider, reason: "declined" });
      continue;
    }
    if (kind === "codex") {
      if (wantCodex) {
        staged.enabled.add(provider);
        markPending(provider);
      } else {
        staged.skipped.push({ provider, reason: "declined" });
      }
      continue;
    }
    if (kind === "oauth") {
      const yes = await prompter.askYesNo(`Enable ${provider} via oauth/login later?`);
      if (yes) {
        staged.enabled.add(provider);
        markPending(provider);
      } else {
        staged.skipped.push({ provider, reason: "declined" });
      }
      continue;
    }

    const url = providerBaseUrl(provider, models);
    log(url ? `  baseUrl: ${url}` : "  (built-in / package provider)");
    const enable = await prompter.askYesNo(`Enable ${provider}?`);
    if (!enable) {
      staged.skipped.push({ provider, reason: "declined" });
      continue;
    }
    const existing = hasApiKey(auth?.[provider]);
    const label = existing
      ? `${provider} API key (key exists, Enter keeps): `
      : `${provider} API key: `;
    const secret = await prompter.askSecret(label);
    if (secret) {
      staged.apiKeys.set(provider, secret);
      staged.enabled.add(provider);
    } else if (existing) {
      staged.enabled.add(provider);
    } else {
      log(`WARNING: ${provider}: no key entered; skipping.`);
      staged.skipped.push({ provider, reason: "no-key" });
    }
  }

  return staged;
}

export function resolveCapabilityModels(keptModels, orderedProviders) {
  const kept = Array.isArray(keptModels) ? keptModels : [];
  const fallbackDefault = firstByPriority(kept, orderedProviders);
  const roles = /** @type {const} */ (["timeline", "scout", "coach", "reviewer"]);
  /** @type {Record<string, { preferred: string, ok: boolean, fallbackDefault: string|null }>} */
  const out = {};
  for (const role of roles) {
    const preferred = CAPABILITY_PREFERRED[role];
    out[role] = {
      preferred,
      ok: kept.includes(preferred),
      fallbackDefault,
    };
  }
  return out;
}

export class SetupAbort extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = "SetupAbort";
    this.exitCode = exitCode;
  }
}

export function isInteractive(input = process.stdin, output = process.stdout) {
  return Boolean(input && input.isTTY && output && output.isTTY);
}

export function parseYesNo(answer) {
  const value = String(answer ?? "").trim();
  return value === "y" || value === "Y" || value === "yes";
}

export function parsePick(answer, count, defaultIndex) {
  const value = String(answer ?? "").trim();
  if (value === "") return defaultIndex;
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  if (n < 1 || n > count) return null;
  return n - 1;
}

export function createPrompter({ input = process.stdin, output = process.stdout } = {}) {
  let buffer = "";
  let mode = "idle"; // idle | line | secret
  let resolveWait = null;
  let rejectWait = null;
  let secretChars = [];
  let closed = false;
  let wasRaw = false;

  function write(text) {
    if (output && typeof output.write === "function") output.write(text);
  }

  function setRaw(enabled) {
    if (typeof input.setRawMode === "function") {
      try {
        input.setRawMode(enabled);
      } catch {
        // ignore streams that advertise setRawMode but reject it
      }
    }
  }

  function finishWait(ok, value) {
    const res = resolveWait;
    const rej = rejectWait;
    resolveWait = null;
    rejectWait = null;
    mode = "idle";
    if (ok) res?.(value);
    else rej?.(value);
  }

  function takeLine() {
    const nl = buffer.search(/\r\n|\n|\r/);
    if (nl < 0) return null;
    const match = buffer.slice(nl).match(/^\r\n|\n|\r/)?.[0] ?? "\n";
    const line = buffer.slice(0, nl);
    buffer = buffer.slice(nl + match.length);
    return line;
  }

  function onData(chunk) {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    if (mode === "line") {
      buffer += text;
      const line = takeLine();
      if (line !== null) finishWait(true, line);
      return;
    }
    if (mode !== "secret") {
      buffer += text;
      return;
    }
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      const code = ch.charCodeAt(0);
      if (ch === "\r" || ch === "\n") {
        let rest = i + 1;
        if (ch === "\r" && text[rest] === "\n") rest += 1;
        const leftover = text.slice(rest);
        if (leftover) buffer = leftover + buffer;
        write("\r\n");
        const value = secretChars.join("");
        secretChars = [];
        setRaw(false);
        finishWait(true, value.trim());
        return;
      }
      if (ch === "\u0003") {
        secretChars = [];
        setRaw(false);
        write("\r\n");
        finishWait(false, new SetupAbort("cancelled", 130));
        return;
      }
      if (ch === "\u007f" || ch === "\b") {
        secretChars.pop();
        continue;
      }
      if (ch === "\u001b") {
        // drop CSI / short escape sequences
        i += 1;
        while (i < text.length) {
          const c = text[i];
          if ((c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || c === "~") break;
          i += 1;
        }
        continue;
      }
      if (code < 0x20) continue;
      secretChars.push(ch);
    }
  }

  function onEnd() {
    if (mode === "idle") return;
    setRaw(false);
    finishWait(false, new SetupAbort("input closed"));
  }

  input.on("data", onData);
  input.on("end", onEnd);
  input.on("error", onEnd);
  if (typeof input.resume === "function") input.resume();

  function waitLine(promptText) {
    if (closed) return Promise.reject(new SetupAbort("prompter closed"));
    write(promptText);
    return new Promise((resolve, reject) => {
      resolveWait = resolve;
      rejectWait = reject;
      mode = "line";
      const line = takeLine();
      if (line !== null) finishWait(true, line);
    });
  }

  async function askYesNo(question) {
    const answer = await waitLine(`${question} [y/N] `);
    return parseYesNo(answer);
  }

  async function askSecret(label) {
    if (closed) throw new SetupAbort("prompter closed");
    wasRaw = Boolean(input.isRaw);
    setRaw(true);
    write(`${label}`);
    secretChars = [];
    try {
      return await new Promise((resolve, reject) => {
        resolveWait = resolve;
        rejectWait = reject;
        mode = "secret";
        if (buffer) {
          const pending = buffer;
          buffer = "";
          onData(pending);
        }
      });
    } finally {
      setRaw(wasRaw);
    }
  }

  async function askPick(label, choices, defaultIndex = 0, options = {}) {
    const count = choices.length;
    if (!count) throw new SetupAbort("askPick needs at least one choice");
    const def = Math.min(Math.max(defaultIndex, 0), count - 1);
    const printChoices = options.printChoices !== false;
    write(`${label}\n`);
    if (printChoices) {
      choices.forEach((choice, i) => {
        write(`  ${i + 1}) ${choice}\n`);
      });
    }
    for (;;) {
      const answer = await waitLine(`Pick 1-${count} [default ${def + 1}]: `);
      const picked = parsePick(answer, count, def);
      if (picked !== null) return picked;
      write(`Invalid pick. Enter 1-${count}.\n`);
    }
  }

  function close() {
    if (closed) return;
    closed = true;
    setRaw(false);
    input.off?.("data", onData);
    input.off?.("end", onEnd);
    input.off?.("error", onEnd);
    if (typeof input.removeListener === "function") {
      input.removeListener("data", onData);
      input.removeListener("end", onEnd);
      input.removeListener("error", onEnd);
    }
    if (typeof input.pause === "function") input.pause();
    if (mode !== "idle") finishWait(false, new SetupAbort("prompter closed"));
  }

  return { askYesNo, askSecret, askPick, close };
}

const PROTECTED_BRANCHES = new Set(["main", "master"]);

/** Auto branch name pi-install-<ddmmyyyy>, suffixed -2, -3... if taken. */
function autoBranchName(root) {
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

function gitAt(root, args) {
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

function runTool(cmd, args, options = {}) {
  const timeout = options.timeout ?? 30_000;
  const stdio = options.stdio ?? ["ignore", "pipe", "pipe"];
  try {
    return spawnSync(cmd, args, {
      encoding: "utf8",
      stdio,
      timeout,
      shell: process.platform === "win32",
      env: options.env ?? process.env,
    });
  } catch (error) {
    return { status: 1, stdout: "", stderr: String(error?.message ?? error), error };
  }
}

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

function pruneEmptyDirs(root) {
  if (!exists(root)) return;
  const stack = [root];
  const seen = [];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
      stack.push(path.join(current, entry.name));
    }
    seen.push(current);
  }
  for (let i = seen.length - 1; i >= 0; i -= 1) {
    const dir = seen[i];
    if (dir === root) continue;
    try {
      if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    } catch {
      // ignore race / non-empty
    }
  }
}

/** Mirror src -> dst file-by-file. Skips node_modules/.git. Preserves those dirs on dst. */
function copyDirReplace(src, dst) {
  if (!exists(src)) return null;
  const started = Date.now();
  fs.mkdirSync(dst, { recursive: true });
  const srcRels = new Set();
  let files = 0;
  let unchanged = 0;
  for (const file of walkFiles(src)) {
    const rel = relPosix(src, file);
    srcRels.add(rel);
    const out = path.join(dst, ...rel.split("/"));
    const bytes = fs.readFileSync(file);
    if (exists(out)) {
      try {
        if (Buffer.compare(bytes, fs.readFileSync(out)) === 0) {
          unchanged += 1;
          continue;
        }
      } catch {
        // fall through to copy
      }
    }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, bytes);
    files += 1;
  }
  let removed = 0;
  for (const file of walkFiles(dst)) {
    const rel = relPosix(dst, file);
    if (srcRels.has(rel)) continue;
    fs.rmSync(file, { force: true });
    removed += 1;
  }
  pruneEmptyDirs(dst);
  return { files, unchanged, removed, ms: Date.now() - started };
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

function run(cmd, args, cwd, options = {}) {
  const stdio = options.stdio ?? "ignore";
  const label = options.label;
  if (label) {
    console.log(`  $ ${cmd} ${args.join(" ")}`);
    console.log(`  cwd: ${cwd}`);
  }
  const started = Date.now();
  const result = spawnSync(cmd, args, { cwd, stdio, shell: process.platform === "win32" });
  if (label) {
    const ms = Date.now() - started;
    if (result.error) console.log(`  ${label} error after ${ms}ms: ${result.error.message}`);
    else console.log(`  ${label} exited ${result.status} in ${ms}ms`);
  }
  return result;
}

function commandOnPath(name) {
  const result = spawnSync(name, ["--version"], { stdio: "ignore", shell: process.platform === "win32" });
  return !result.error && result.status === 0;
}

const PI_PKG = "@earendil-works/pi-coding-agent";

function extensionInstallSpec() {
  if (commandOnPath("bun")) {
    return { cmd: "bun", args: ["install", "--production"] };
  }
  return { cmd: "npm", args: ["install", "--omit=dev", "--no-fund", "--no-audit"] };
}

function npmGlobalPiDir() {
  const result = spawnSync("npm", ["root", "-g"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.error || result.status !== 0) return null;
  const dir = path.join(result.stdout.trim(), "@earendil-works", "pi-coding-agent");
  return exists(path.join(dir, "package.json")) ? dir : null;
}

function bunGlobalPiDir() {
  const dir = path.join(os.homedir(), ".bun", "install", "global", "node_modules", "@earendil-works", "pi-coding-agent");
  return exists(path.join(dir, "package.json")) ? dir : null;
}

function piBinary() {
  const bunHome = process.env.BUN_INSTALL || path.join(os.homedir(), ".bun");
  const local = path.join(bunHome, "bin", process.platform === "win32" ? "pi.cmd" : "pi");
  if (exists(local)) return local;
  return commandOnPath("pi") ? "pi" : null;
}

function updatePiAndExtensions() {
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

function prependBunBin() {
  const dir = path.join(process.env.BUN_INSTALL || path.join(os.homedir(), ".bun"), "bin");
  const parts = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  if (!parts.includes(dir)) process.env.PATH = [dir, ...parts].join(path.delimiter);
}

function ensureBun() {
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

function ensureBunPiCli() {
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

function parseSetupArgs(argv) {
  const flags = { createBranch: null, createBranchGiven: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help") {
      printSetupHelp();
      process.exit(0);
    } else if (arg === "--create-branch") {
      const name = argv[i + 1];
      if (!name || name.startsWith("-")) {
        flags.createBranch = autoBranchName();
      } else {
        i += 1;
        flags.createBranch = name;
      }
      if (flags.createBranchGiven) die("--create-branch given more than once.");
      flags.createBranchGiven = true;
    } else {
      die(`Unknown setup option ${arg}`);
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
  ensureBunPiCli();
  console.log(`Copying .pi/agent -> ${HOME_AGENT}\n`);
  console.log("  Overwriting protected files.\n");
  fs.mkdirSync(HOME_AGENT, { recursive: true });
  let copied = 0;
  let skipped = 0;
  for (const [label, name] of [["extensions", "extensions"], ["skills", "skills"], ["themes", "themes"]]) {
    if (label === "skills") applySparseCheckouts(path.join(REPO_AGENT, "skills"));
    if (label === "extensions") {
      console.log("[extensions]");
      const extStats = copyDirReplace(path.join(REPO_AGENT, name), path.join(HOME_AGENT, name));
      if (extStats) {
        console.log(`  Mirrored ${extStats.files} files (${extStats.unchanged} unchanged), removed ${extStats.removed} orphans in ${extStats.ms}ms`);
        console.log("  Skipped: node_modules, .git (preserved on live if present)");
        copied += 1;
      }
      console.log("");
      const extDir = path.join(HOME_AGENT, "extensions");
      if (exists(path.join(extDir, "package.json"))) {
        const spec = extensionInstallSpec();
        console.log(`[extensions ${spec.cmd}]`);
        const lock = path.join(extDir, "package-lock.json");
        const nm = path.join(extDir, "node_modules");
        console.log(`  package-lock.json: ${exists(lock) ? "yes" : "missing (full resolve)"}`);
        console.log(`  node_modules: ${exists(nm) ? "preserved" : "absent (cold install)"}`);
        console.log(`  starting ${spec.cmd} install (output below)...`);
        const result = run(spec.cmd, spec.args, extDir, {
          stdio: "inherit",
          label: `${spec.cmd} install`,
        });
        if (result.status === 0) console.log(`  ${spec.cmd} install complete.\n`);
        else console.log(`  WARNING: ${spec.cmd} install failed (status ${result.status ?? "unknown"}).\n`);
      }
      continue;
    }
    console.log(`[${label}]`);
    const stats = copyDirReplace(path.join(REPO_AGENT, name), path.join(HOME_AGENT, name));
    if (stats) {
      console.log(`  Mirrored ${stats.files} files (${stats.unchanged} unchanged), removed ${stats.removed} orphans in ${stats.ms}ms`);
      console.log("  Skipped: node_modules, .git");
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
  console.log("\n[bin]");
  const binDir = path.join(HOME_AGENT, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  for (const name of ["tf", "ssm-server"]) {
    const src = path.join(REPO_ROOT, "scripts", name === "ssm-server" ? "ssm-server.mjs" : name);
    if (!exists(src)) continue;
    const dst = path.join(binDir, name);
    fs.copyFileSync(src, dst);
    fs.chmodSync(dst, 0o755);
    console.log(`  Copied ${name} -> ${dst}`);
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
  updatePiAndExtensions();
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

async function setup(flags) {
  if (!isInteractive()) throw new SetupAbort("setup needs an interactive terminal (TTY).");
  // Load before any git write so a bad JSON never leaves an orphan branch.
  const inputs = loadSetupInputs(REPO_AGENT);
  const order = orderProviders(inputs.settings.enabledModels);
  const capSources = loadCapabilitySources(REPO_AGENT);

  const gate = branchGate(REPO_ROOT, flags.createBranch ?? "auto");
  console.log(gate.created ? `Created branch ${gate.branch}.` : `On branch ${gate.branch}.`);

  const claude = probeClaude();
  console.log(claude.found ? `Claude Code CLI: ${claude.version}` : "Claude Code CLI: not found on PATH");
  if (claude.found) {
    const upd = updateClaude();
    if (upd.ok) console.log(`Claude update: ran ${upd.path}`);
    else console.log(`WARNING: Claude update failed (${upd.detail}); continuing.`);
  }

  let runInstall = false;
  let staged = null;
  const prompter = createPrompter();
  try {
    const wantClaude = await prompter.askYesNo(
      "Do you have Claude Code CLI / want claude-code-cli models?",
    );
    const wantCodex = await prompter.askYesNo(
      "Do you have a Codex subscription (openai-codex oauth)?",
    );
    console.log(
      `Phase 1: claude-code-cli=${wantClaude ? "yes" : "no"}, openai-codex=${wantCodex ? "yes" : "no"}`,
    );

    staged = await collectProviders({
      order,
      auth: inputs.auth,
      models: inputs.models,
      wantClaude,
      wantCodex,
      prompter,
    });
    console.log(describeStaged(staged, order));

    let settingsPlan;
    try {
      settingsPlan = planSettings(inputs.settings, staged, order);
    } catch (error) {
      if (error instanceof SetupAbort && error.message === "enable at least one provider" && gate.created) {
        throw new SetupAbort(
          `enable at least one provider (now on branch ${gate.branch}; re-run without --create-branch)`,
        );
      }
      throw error;
    }
    console.log(describeSettingsPlan(settingsPlan, inputs.settings));

    const resolvedCaps = resolveCapabilityModels(settingsPlan.kept, order);
    const capTargets = await resolveCapabilityTargets({
      kept: settingsPlan.kept,
      order,
      resolved: resolvedCaps,
      prompter,
    });
    const capEdits = planCapabilityEdits(capSources, capTargets);
    console.log(describeCapabilityPlan(capTargets, capEdits));

    const report = persistSetup({
      agentDir: REPO_AGENT,
      staged,
      settingsPlan,
      settingsText: inputs.settingsText,
      capEdits,
    });
    console.log(describePersistSummary({ gate, staged, order, capTargets, report }));
    try {
      runInstall = await prompter.askYesNo("Run make install now?");
    } catch (error) {
      if (error instanceof SetupAbort && error.exitCode === 130) {
        throw new SetupAbort("files already written; install skipped", 130);
      }
      throw error;
    }
  } finally {
    prompter.close();
  }

  if (runInstall) {
    try {
      install({ yes: false, prune: false, host: null });
    } catch (error) {
      console.log(`WARNING: install failed: ${error?.message ?? error}`);
    }
  }
  if (staged) printPostSetupHints(staged, runInstall);
}

function printSetupHelp() {
  console.log(`Usage:
  node scripts/pi.mjs setup [--create-branch [NAME]]
  make setup

On main/master/detached HEAD, setup auto-creates a local branch pi-install-<ddmmyyyy>
(-2, -3... if taken). --create-branch NAME pins a specific branch name.

--create-branch [NAME]  Pin branch name; bare flag or plain make setup auto-generates.
--help                  Show this help

Needs a TTY. Writes only repo .pi/agent files; never ~/.pi except via optional install.`);
}

function printHelp() {
  console.log(`my-pi config CLI

Usage:
  node scripts/pi.mjs install [-h HOST]
  node scripts/pi.mjs sync [-p]
  node scripts/pi.mjs setup [--create-branch NAME] [--help]
  node scripts/pi.mjs help

install  Copy repo .pi/agent -> ~/.pi/agent; drop npm global pi; bun install -g if missing;
         then run \`pi update\` and \`pi update --extensions\`
sync     Copy live ~/.pi/agent -> repo .pi/agent
setup    Interactive provider/auth bootstrap on a local branch (see setup --help)

-h HOST  Set models.json proxy origin on install
-p       Prune repo files missing from live on sync
-y       Accepted, unused (protected files always overwritten)

auth.json: api_key merge both ways (incoming override, dest-only stay).
  oauth (type=oauth) flows home -> repo on sync only; install never overwrites live oauth.
install also updates the pi CLI and installed packages via \`pi update\` + \`pi update --extensions\`.`);
}

function isMain() {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return fs.realpathSync(argv1) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

function main(argv) {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help") {
    printHelp();
    process.exit(0);
  }
  if (command === "setup") {
    const setupFlags = parseSetupArgs(rest);
    setup(setupFlags).then(
      () => process.exit(0),
      (error) => {
        if (!(error instanceof SetupAbort)) throw error;
        console.error(`ERROR: ${error.message}`);
        process.exit(error.exitCode);
      },
    );
    return;
  }
  const flags = parseArgs(rest);
  if (command === "install") install(flags);
  else if (command === "sync") sync(flags);
  else die(`Unknown command ${command}. Use install, sync, setup, or help.`);
}

if (isMain()) main(process.argv.slice(2));
