import fs from "node:fs";
import path from "node:path";
import { SetupAbort } from "../errors.mjs";
import { exists } from "../fs/read-write.mjs";
import { CAPABILITY_PREFERRED, CAP_ROLES, THINKING_LEVELS, firstByPriority, providerOf, parseCapabilityTarget, inheritCapabilityTargets, formatCapabilityTargets, supportedThinkingLevels } from "./providers.mjs";

const CAP_DIR = ["extensions", "capability-tools", "capabilities"];
const CAP_ROLE_BY_TOOL = {
  reasoning_coach: "coach",
  patch_reviewer: "reviewer",
  code_scout: "scout",
  commit_message: "commit",
};

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

function replaceQuotedTimeline(text, pathLabel, target, key = "timelineModel") {
  const re = new RegExp(`^([ \\t]*${key}:\\s*")([^"\\n]*)(",?[ \\t\\r]*)$`, "gm");
  const matches = [...text.matchAll(re)];
  if (matches.length !== 1) {
    throw new SetupAbort(`${pathLabel}: expected exactly one quoted ${key} literal, found ${matches.length}`);
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
    assertUniqueKeys(filePath, parsed.counts, ["model", "timelineModel", "reasoningEffort", "timelineReasoningEffort", "tool"]);
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

function setFrontmatterValue(text, key, target, insert = false) {
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
  if (!found && insert) {
    lines.splice(parsed.end, 0, `${key}: ${target}`);
    changed = true;
  }
  if (!changed) return null;
  let out = lines.join(parsed.eol);
  if (text.endsWith("\r\n")) {
    if (!out.endsWith("\r\n")) out += "\r\n";
  } else if (text.endsWith("\n")) {
    if (!out.endsWith("\n")) out += "\n";
  }
  return out;
}

export function planCapabilityEdits(sources, selections) {
  const targets = {};
  const efforts = {};
  for (const [role, value] of Object.entries(inheritCapabilityTargets(selections))) {
    const parsed = parseCapabilityTarget(value);
    if (!CAP_ROLES.includes(role) || !parsed) throw new SetupAbort(`invalid capability target for ${role}`);
    targets[role] = parsed.model;
    if (parsed.reasoningEffort !== undefined) efforts[role] = parsed.reasoningEffort;
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

    const effortKeys = [
      ["reasoningEffort", role && efforts[role], true],
      ["timelineReasoningEffort", efforts.timeline, false],
    ];
    for (const [key, effort, insert] of effortKeys) {
      if (!effort) continue;
      const next = setFrontmatterValue(afterText, key, effort, insert);
      if (next) {
        changes.push({ key, from: cap.fm[key] ?? "(default)", to: effort });
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
    let defAfter = replaceQuotedTimeline(sources.definitions.text, sources.definitions.path, targets.timeline);
    const defChanges = [{ key: "timelineModel", from: "(definitions.ts)", to: targets.timeline }];
    if (efforts.timeline) {
      defAfter = replaceQuotedTimeline(defAfter, sources.definitions.path, efforts.timeline, "timelineReasoningEffort");
      defChanges.push({ key: "timelineReasoningEffort", from: "(definitions.ts)", to: efforts.timeline });
    }
    if (defAfter !== sources.definitions.text) {
      edits.push({
        path: sources.definitions.path,
        before: sources.definitions.text,
        after: defAfter,
        changes: defChanges,
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
  const roles = CAP_ROLES;
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

function sourceEffort(sources, role) {
  const key = role === "timeline" ? "timelineReasoningEffort" : "reasoningEffort";
  const cap = sources?.caps.find((item) => CAP_ROLE_BY_TOOL[normalizeToolName(item.fm.tool)] === role);
  const literal = sources?.definitions.text.match(new RegExp(`${key}:\\s*"([^"]*)"`))?.[1];
  return [cap?.fm[key], literal, "high"].find((value) => THINKING_LEVELS.includes(value));
}

export async function resolveCapabilityTargets({ kept, order, resolved, prompter, sources, models, previous = {}, log = console.log }) {
  const choices = prioritySortedKept(kept, order);
  if (!choices.length) throw new SetupAbort("enable at least one provider");
  const prior = previous;
  const targets = {};
  log("Phase 4: pick a model and reasoning effort for each capability and timeline.");
  if (choices.length === 1) log(`Only one enabled model; using ${choices[0]} for all roles.`);
  let printed = false;
  for (const role of CAP_ROLES) {
    const existing = parseCapabilityTarget(prior[role]);
    const preferred = existing && choices.includes(existing.model) ? existing.model : resolved[role].preferred;
    const defIdx = Math.max(0, choices.indexOf(preferred));
    const label = role === "scout" ? "code scout" : role === "commit" ? "commit message" : role;
    let model = choices[0];
    if (choices.length > 1) {
      const idx = await prompter.askPick(`${label} model`, choices, defIdx, { printChoices: !printed });
      printed = true;
      model = choices[idx];
    }
    const defaultEffort = existing?.model === model && existing.reasoningEffort
      ? existing.reasoningEffort : sourceEffort(sources, role);
    const efforts = supportedThinkingLevels(model, models);
    const effortDefIdx = Math.max(0, efforts.indexOf(defaultEffort));
    const effortIndex = await prompter.askPick(`${label} reasoning effort (${model})`, efforts, effortDefIdx);
    targets[role] = { model, reasoningEffort: efforts[effortIndex] };
  }
  return targets;
}

export function describeCapabilityPlan(targets, edits) {
  return `Phase 4: ${formatCapabilityTargets(targets)}; files to edit: ${edits.length}`;
}
