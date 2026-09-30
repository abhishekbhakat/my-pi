import fs from "node:fs";
import path from "node:path";
import { SetupAbort } from "../errors.mjs";
import { exists } from "../fs/read-write.mjs";
import { CAPABILITY_PREFERRED, firstByPriority, providerOf } from "./providers.mjs";

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
  let printed = false;
  for (const role of need) {
    const label = `${role === "scout" ? "scout/commit" : role} (preferred ${resolved[role].preferred} not enabled)`;
    const idx = await prompter.askPick(label, choices, 0, { printChoices: !printed });
    printed = true;
    targets[role] = choices[idx];
  }
  return targets;
}

export function describeCapabilityPlan(targets, edits) {
  return `Phase 4: timeline=${targets.timeline}; scout/commit=${targets.scout}; coach=${targets.coach}; reviewer=${targets.reviewer}; files to edit: ${edits.length}`;
}
