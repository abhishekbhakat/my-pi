import fs from "node:fs";
import path from "node:path";
import { SetupAbort } from "../errors.mjs";
import { exists, parseJsonObjectFile, writeAtomic } from "../fs/read-write.mjs";
import { isOauthEntry } from "./providers.mjs";

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

export function persistSetup({ agentDir, staged, settingsPlan, settingsText, capEdits, deciderContents }) {
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

  if (deciderContents) {
    const decidersPath = path.join(agentDir, "deciders.json");
    const prevDeciders = exists(decidersPath) ? fs.readFileSync(decidersPath, "utf8") : null;
    if (deciderContents !== prevDeciders) {
      writes.push({ path: decidersPath, contents: deciderContents, rel: ".pi/agent/deciders.json" });
    } else {
      unchanged.push(".pi/agent/deciders.json");
    }
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

export function describePersistSummary({ gate, staged, order, capTargets, deciderPlan, report, patchInfo }) {
  const enabled = order.filter((p) => staged.enabled.has(p)).join(",") || "(none)";
  const skipped = staged.skipped.length
    ? staged.skipped.map((s) => `${s.provider}(${s.reason})`).join(",")
    : "(none)";
  const pending = staged.oauthPending.length ? staged.oauthPending.join(",") : "(none)";
  const authLine = report.authKeys.length
    ? `auth.json: updated keys for ${report.authKeys.join(",")}`
    : "auth.json: unchanged";
  const where = gate.branch ? `branch ${gate.branch}` : "detached HEAD";
  const patchLine = patchInfo
    ? `userprofile.patch: ${patchInfo.hunks} hunks (${patchInfo.bytes} bytes)`
    : "userprofile.patch: (not written)";
  return [
    `Setup complete on ${where} (no lasting branch). base=${gate.baseSha?.slice?.(0, 12) ?? "?"}`,
    `  enabled: ${enabled}`,
    `  skipped: ${skipped}`,
    `  oauth-pending: ${pending}`,
    `  capabilities: timeline=${capTargets.timeline}; scout/commit=${capTargets.scout}; coach=${capTargets.coach}; reviewer=${capTargets.reviewer}`,
    deciderPlan
      ? `  deciders: booleanGuy=${deciderPlan.roles.booleanGuy}; prune=${deciderPlan.roles.prune}; compaction=${deciderPlan.roles.compaction}; guard=${deciderPlan.roles.guard}`
      : "  deciders: skipped",
    `  ${authLine}`,
    `  ${patchLine}`,
    `  staged writes before restore: ${report.written.join(", ") || "(none)"}`,
    "  Tracked .pi/agent restored to HEAD. Keep userprofile.patch untracked. Do not commit secrets.",
  ].join("\n");
}

export function printPostSetupHints(staged, ranInstall) {
  console.log("Personalization lives in userprofile.patch + .pi/agent/auth.json (both untracked).");
  console.log("make install applies the patch in a temp staging dir, then copies to ~/.pi.");
  console.log("If the patch stops applying after a pull, run make setup again.");
  console.log("Run /reload or /restart inside pi to pick up changes.");
  for (const provider of staged.oauthPending) {
    console.log(`Run /login ${provider} inside pi.`);
  }
  if (!ranInstall) console.log("Run make install to apply repo config to ~/.pi.");
}
