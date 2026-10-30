import fs from "node:fs";
import path from "node:path";
import { SetupAbort } from "../errors.mjs";
import { exists, parseJsonObjectFile, writeAtomic } from "../fs/read-write.mjs";
import { isOauthEntry, formatCapabilityTargets } from "./providers.mjs";

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

export function persistSetup({ agentDir, staged, settingsText, decidersText, capEdits }) {
  /** @type {{ path: string, contents: string, mode?: number, rel: string }[]} */
  const writes = [];
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
    }
  }

  // Tracked files are never written here: settings, decider roles and capability
  // targets travel in userprofile.json and are applied to a staging copy at
  // install time. Validate that those files did not change mid-session so the
  // profile matches what was planned.
  const settingsPath = path.join(agentDir, "settings.json");
  if (fs.readFileSync(settingsPath, "utf8") !== settingsText) {
    throw new SetupAbort("settings.json changed during setup; re-run");
  }
  if (decidersText !== null && decidersText !== undefined) {
    const decidersPath = path.join(agentDir, "deciders.json");
    const live = exists(decidersPath) ? fs.readFileSync(decidersPath, "utf8") : null;
    if (live !== decidersText) throw new SetupAbort("deciders.json changed during setup; re-run");
  }
  for (const edit of capEdits) {
    const rel = assertUnderAgentDir(agentDir, edit.path);
    if (fs.readFileSync(edit.path, "utf8") !== edit.before) {
      throw new SetupAbort(`${rel} changed since plan; re-run setup`);
    }
  }

  for (const w of writes) writeAtomic(w.path, w.contents, w.mode);
  return {
    written: writes.map((w) => w.rel),
    authKeys,
  };
}

export function describePersistSummary({ gate, staged, order, capTargets, deciderPlan, report, profileInfo }) {
  const enabled = order.filter((p) => staged.enabled.has(p)).join(",") || "(none)";
  const skipped = staged.skipped.length
    ? staged.skipped.map((s) => `${s.provider}(${s.reason})`).join(",")
    : "(none)";
  const pending = staged.oauthPending.length ? staged.oauthPending.join(",") : "(none)";
  const authLine = report.authKeys.length
    ? `auth.json: updated keys for ${report.authKeys.join(",")}`
    : "auth.json: unchanged";
  const where = gate.branch ? `branch ${gate.branch}` : "detached HEAD";
  const profileLine = profileInfo
    ? `userprofile.json: ${profileInfo.sections.join(", ") || "(empty)"} (${profileInfo.bytes} bytes)`
    : "userprofile.json: (not written)";
  return [
    `Setup complete on ${where} (no lasting branch). base=${gate.baseSha?.slice?.(0, 12) ?? "?"}`,
    `  enabled: ${enabled}`,
    `  skipped: ${skipped}`,
    `  oauth-pending: ${pending}`,
    `  capabilities: ${formatCapabilityTargets(capTargets)}`,
    deciderPlan
      ? `  deciders: booleanGuy=${deciderPlan.roles.booleanGuy}; prune=${deciderPlan.roles.prune}; compaction=${deciderPlan.roles.compaction}; guard=${deciderPlan.roles.guard}`
      : "  deciders: skipped",
    `  ${authLine}`,
    `  ${profileLine}`,
    "  Tracked .pi/agent untouched. Keep userprofile.json untracked. Do not commit secrets.",
  ].join("\n");
}

export function printPostSetupHints(staged) {
  console.log("Personalization lives in userprofile.json + .pi/agent/auth.json (both untracked).");
  console.log("Next: make install — merges userprofile.json onto repo .pi/agent in a temp staging dir, then copies to ~/.pi.");
  console.log("userprofile.json is plain JSON; edit it directly or re-run make setup to regenerate.");
  for (const provider of staged.oauthPending) {
    console.log(`Run /login ${provider} inside pi.`);
  }
  console.log("After install, run /reload or /restart inside pi.");
}
