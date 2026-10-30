import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SetupAbort } from "../errors.mjs";
import { exists, parseJsonObjectFile, writeAtomic } from "../fs/read-write.mjs";
import { copyDirReplace, rmTree } from "../fs/tree.mjs";
import { PROFILE_PATCH, REPO_AGENT, REPO_ROOT, USER_PROFILE } from "../paths.mjs";
import { loadCapabilitySources, planCapabilityEdits } from "./capabilities.mjs";
import { DECIDER_ROLES } from "./deciders.mjs";
import { isOauthEntry, CAP_ROLES } from "./providers.mjs";
import { THINKING_LEVELS } from "./settings-plan.mjs";

export const USER_PROFILE_VERSION = 1;

/** Keys of settings.json that setup manages and userprofile.json may carry. */
const SETTINGS_KEYS = new Set(["enabledModels", "defaultProvider", "defaultModel", "modelThinkingLevels"]);

/** api_key entries of an auth.json object. OAuth entries never travel in the profile. */
export function apiKeyEntries(auth) {  const out = {};
  for (const [provider, entry] of Object.entries(auth ?? {})) {
    if (
      entry
      && typeof entry === "object"
      && !Array.isArray(entry)
      && entry.type === "api_key"
      && typeof entry.key === "string"
      && entry.key.trim()
    ) {
      out[provider] = entry;
    }
  }
  return out;
}

/**
 * Profile data from setup plans. Sections stay optional so a partial setup
 * still yields a valid profile.
 */
export function buildUserProfile({ settingsPlan, deciderPlan, capTargets, auth } = {}) {
  const profile = { version: USER_PROFILE_VERSION };
  if (settingsPlan?.next) {
    const settings = {};
    if (Array.isArray(settingsPlan.next.enabledModels)) settings.enabledModels = settingsPlan.next.enabledModels;
    if (settingsPlan.next.defaultProvider) settings.defaultProvider = settingsPlan.next.defaultProvider;
    if (settingsPlan.next.defaultModel) settings.defaultModel = settingsPlan.next.defaultModel;
    if (settingsPlan.next.modelThinkingLevels) {
      settings.modelThinkingLevels = settingsPlan.next.modelThinkingLevels;
    }
    profile.settings = settings;
  }
  if (deciderPlan) {
    profile.deciders = { roles: deciderPlan.roles };
    if (deciderPlan.cloudflareAccountId) {
      profile.deciders.providers = { cloudflare: { accountId: deciderPlan.cloudflareAccountId } };
    }
  }
  if (capTargets) profile.capabilities = capTargets;
  const authKeys = apiKeyEntries(auth);
  if (Object.keys(authKeys).length) profile.auth = authKeys;
  return profile;
}

/** Serialize + write userprofile.json. Carries api_key auth entries, so keep it untracked. */
export function writeUserProfile({
  profile,
  profilePath = USER_PROFILE,
} = {}) {
  if (!profile || typeof profile !== "object") throw new SetupAbort("writeUserProfile: profile object required");
  const text = `${JSON.stringify(profile, null, 2)}\n`;
  writeAtomic(profilePath, text, 0o600);
  const sections = Object.keys(profile).filter((key) => key !== "version");
  return { path: profilePath, bytes: text.length, sections };
}

/** Delete a legacy userprofile.patch left by the old setup flow. */
export function removeLegacyProfilePatch({ patchPath = PROFILE_PATCH, log = console.log } = {}) {
  if (!exists(patchPath)) return false;
  fs.rmSync(patchPath);
  log(`Removed legacy ${patchPath} (replaced by userprofile.json).`);
  return true;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergePlainObjects(base, overlay) {
  const out = { ...(base ?? {}) };
  for (const [key, value] of Object.entries(overlay ?? {})) {
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = mergePlainObjects(out[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function validSettingsEntry(key, value) {
  switch (key) {
    case "enabledModels":
      return Array.isArray(value) && value.length > 0 && value.every((ref) => typeof ref === "string" && ref.trim());
    case "defaultProvider":
    case "defaultModel":
      return typeof value === "string" && value.trim() !== "";
    case "modelThinkingLevels":
      return (
        isPlainObject(value)
        && Object.values(value).every((level) => THINKING_LEVELS.includes(level))
      );
    default:
      return false;
  }
}

/** Merge profile settings onto the agent dir's settings.json. Non-managed keys warn+skip. */
function applySettingsProfile(agentDir, settings) {
  if (!isPlainObject(settings)) throw new SetupAbort("settings section must be an object");
  const settingsPath = path.join(agentDir, "settings.json");
  const parsed = parseJsonObjectFile(settingsPath);
  if (!parsed.ok) throw new SetupAbort(`settings.json: ${parsed.reason}`);
  const applied = [];
  const skipped = [];
  let next = { ...parsed.data };
  for (const [key, value] of Object.entries(settings)) {
    if (!SETTINGS_KEYS.has(key) || !validSettingsEntry(key, value)) {
      skipped.push(key);
      continue;
    }
    if (key === "modelThinkingLevels") {
      next = { ...next, modelThinkingLevels: { ...(next.modelThinkingLevels ?? {}), ...value } };
    } else {
      next = { ...next, [key]: value };
    }
    applied.push(key);
  }
  if (!applied.length) throw new SetupAbort("no valid settings keys in profile");
  const before = fs.readFileSync(settingsPath, "utf8");
  const after = `${JSON.stringify(next, null, 2)}\n`;
  if (after !== before) writeAtomic(settingsPath, after);
  return { applied, skipped };
}

/** Merge profile decider roles/providers onto the agent dir's deciders.json. */
function applyDecidersProfile(agentDir, deciders) {
  if (!isPlainObject(deciders)) throw new SetupAbort("deciders section must be an object");
  const decidersPath = path.join(agentDir, "deciders.json");
  if (!exists(decidersPath)) throw new SetupAbort("deciders.json missing");
  const parsed = parseJsonObjectFile(decidersPath);
  if (!parsed.ok) throw new SetupAbort(`deciders.json: ${parsed.reason}`);
  const applied = [];
  const skipped = [];

  if (deciders.roles !== undefined) {
    if (!isPlainObject(deciders.roles)) throw new SetupAbort("deciders.roles must be an object");
    const roles = { ...(isPlainObject(parsed.data.roles) ? parsed.data.roles : {}) };
    for (const [role, modelId] of Object.entries(deciders.roles)) {
      if (!DECIDER_ROLES.includes(role) || typeof modelId !== "string" || !modelId.trim()) {
        skipped.push(`roles.${role}`);
        continue;
      }
      roles[role] = modelId;
      applied.push(`roles.${role}`);
    }
    parsed.data.roles = roles;
  }

  if (deciders.providers !== undefined) {
    if (!isPlainObject(deciders.providers)) throw new SetupAbort("deciders.providers must be an object");
    parsed.data.providers = mergePlainObjects(parsed.data.providers, deciders.providers);
    applied.push("providers");
  }

  if (!applied.length) throw new SetupAbort("no valid decider entries in profile");
  const before = fs.readFileSync(decidersPath, "utf8");
  const after = `${JSON.stringify(parsed.data, null, 2)}\n`;
  if (after !== before) writeAtomic(decidersPath, after);
  return { applied, skipped };
}

export function loadCapabilityPreferences(profilePath = USER_PROFILE) {
  if (!exists(profilePath)) return {};
  const parsed = parseJsonObjectFile(profilePath, { redact: true });
  if (!parsed.ok || parsed.data.version !== USER_PROFILE_VERSION) return {};
  return isPlainObject(parsed.data.capabilities) ? parsed.data.capabilities : {};
}

/** Rewrite capability frontmatter + timeline literals from profile targets. */
function applyCapabilitiesProfile(agentDir, capabilities) {
  if (!isPlainObject(capabilities)) throw new SetupAbort("capabilities section must be an object");
  const targets = {};
  const skipped = [];
  for (const [role, ref] of Object.entries(capabilities)) {
    if (!CAP_ROLES.includes(role)) {
      skipped.push(role);
      continue;
    }
    targets[role] = ref;
  }
  if (!Object.keys(targets).length) throw new SetupAbort("no capability roles in profile");
  // planCapabilityEdits validates target refs and frontmatter/literal anchors.
  const sources = loadCapabilitySources(agentDir);
  const edits = planCapabilityEdits(sources, targets);
  for (const edit of edits) writeAtomic(edit.path, edit.after);
  return {
    applied: edits.map((edit) => path.relative(agentDir, edit.path).split(path.sep).join("/")),
    skipped,
  };
}

/** Merge profile api_key entries onto the agent dir's auth.json. */
function applyAuthProfile(agentDir, auth) {
  if (!isPlainObject(auth)) throw new SetupAbort("auth section must be an object");
  const authPath = path.join(agentDir, "auth.json");
  let current = {};
  if (exists(authPath)) {
    const parsed = parseJsonObjectFile(authPath, { redact: true });
    if (!parsed.ok) throw new SetupAbort(`auth.json: ${parsed.reason}`);
    current = parsed.data;
  }
  const next = { ...current };
  const applied = [];
  const skipped = [];
  for (const [provider, entry] of Object.entries(auth)) {
    if (
      !isPlainObject(entry)
      || entry.type !== "api_key"
      || typeof entry.key !== "string"
      || !entry.key.trim()
    ) {
      skipped.push(provider);
      continue;
    }
    if (isOauthEntry(next[provider])) {
      skipped.push(provider);
      continue;
    }
    next[provider] = entry;
    applied.push(provider);
  }
  if (!applied.length) throw new SetupAbort("no valid auth keys in profile");
  const before = exists(authPath) ? fs.readFileSync(authPath, "utf8") : null;
  const after = `${JSON.stringify(next, null, 2)}\n`;
  if (before !== after) writeAtomic(authPath, after, 0o600);
  return { applied, skipped };
}

/**
 * Apply userprofile.json onto a copied agent dir. Structural problems warn and
 * fall back to repo defaults; install never aborts on profile issues.
 * @returns {{ status: "applied"|"none", applied: string[], warnings: string[] }}
 */
export function applyUserProfile(
  agentDir,
  { profilePath = USER_PROFILE, noProfile = false, root = REPO_ROOT, log = console.log } = {},
) {
  const warnings = [];
  const applied = [];
  if (noProfile) {
    log("userprofile.json: skipped (--no-profile)");
    return { status: "none", applied, warnings };
  }
  if (!exists(profilePath)) {
    if (exists(path.join(root, "userprofile.patch"))) {
      const message = `found legacy userprofile.patch; ignored. Run make setup to write userprofile.json, then delete the patch.`;
      log(`WARNING: ${message}`);
      warnings.push(message);
    } else {
      log("no userprofile.json; installing repo .pi/agent as-is");
    }
    return { status: "none", applied, warnings };
  }

  const parsed = parseJsonObjectFile(profilePath);
  if (!parsed.ok) {
    const message = `userprofile.json ignored: ${parsed.reason}`;
    log(`WARNING: ${message}`);
    return { status: "none", applied, warnings: [...warnings, message] };
  }
  const profile = parsed.data;
  if (profile.version !== USER_PROFILE_VERSION) {
    const message = `userprofile.json ignored: unsupported version ${JSON.stringify(profile.version)} (expected ${USER_PROFILE_VERSION})`;
    log(`WARNING: ${message}`);
    return { status: "none", applied, warnings: [...warnings, message] };
  }
  if (exists(path.join(root, "userprofile.patch"))) {
    log("legacy userprofile.patch present but ignored; userprofile.json wins. Delete the patch.");
  }

  const sections = [
    ["settings", profile.settings, applySettingsProfile],
    ["deciders", profile.deciders, applyDecidersProfile],
    ["capabilities", profile.capabilities, applyCapabilitiesProfile],
    ["auth", profile.auth, applyAuthProfile],
  ];
  for (const [name, sectionData, applier] of sections) {
    if (sectionData === undefined) continue;
    try {
      const result = applier(agentDir, sectionData);
      if (result.applied.length) {
        applied.push(...result.applied.map((entry) => `${name}.${entry}`));
        log(`userprofile.json ${name}: applied (${result.applied.join(", ")})`);
      }
      for (const skipped of result.skipped) {
        const message = `userprofile.json ${name}.${skipped}: unknown or invalid; skipped`;
        log(`WARNING: ${message}`);
        warnings.push(message);
      }
    } catch (error) {
      if (!(error instanceof SetupAbort)) throw error;
      const message = `userprofile.json ${name} not applied: ${error.message}`;
      log(`WARNING: ${message}`);
      warnings.push(message);
    }
  }
  return { status: applied.length ? "applied" : "none", applied, warnings };
}

/** Refresh the auth section of userprofile.json from an auth.json file (sync). */
export function syncProfileAuth({
  profilePath = USER_PROFILE,
  authPath,
  log = console.log,
} = {}) {
  if (!exists(profilePath)) return null;
  const parsed = parseJsonObjectFile(profilePath);
  if (!parsed.ok) {
    const reason = parsed.reason;
    log(`WARNING: userprofile.json auth not refreshed: ${reason}`);
    return null;
  }
  const profile = parsed.data;
  if (profile.version !== USER_PROFILE_VERSION) {
    log(`WARNING: userprofile.json auth not refreshed: unsupported version ${JSON.stringify(profile.version)}`);
    return null;
  }
  const authPathToUse = authPath ?? path.join(REPO_AGENT, "auth.json");
  const auth = exists(authPathToUse) ? parseJsonObjectFile(authPathToUse, { redact: true }) : { ok: true, data: {} };
  if (!auth.ok) {
    log(`WARNING: userprofile.json auth not refreshed: ${authPathToUse} ${auth.reason}`);
    return null;
  }
  const keys = apiKeyEntries(auth.data);
  profile.auth = keys;
  writeAtomic(profilePath, `${JSON.stringify(profile, null, 2)}\n`, 0o600);
  return Object.keys(keys).length;
}

/**
 * Copy repo agent tree to a temp staging dir and apply userprofile.json there.
 * @returns {{ dir: string, agentDir: string, status: "applied"|"none", applied: string[], warnings: string[], cleanup: () => void }}
 */
export function stageAgentTree({
  repoAgent = REPO_AGENT,
  noProfile = false,
  root = REPO_ROOT,
  profilePath = USER_PROFILE,
  log = console.log,
} = {}) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "my-pi-install-"));
  const agentDir = path.join(tmpRoot, ".pi", "agent");
  fs.mkdirSync(path.dirname(agentDir), { recursive: true });
  const cleanup = () => rmTree(tmpRoot);
  try {
    copyDirReplace(repoAgent, agentDir);
    const result = applyUserProfile(agentDir, { profilePath, noProfile, root, log });
    return { dir: tmpRoot, agentDir, ...result, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}
