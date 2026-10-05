import { SetupAbort } from "../errors.mjs";
import { filterEnabledModels, modelIdOf, providerOf, resolveDefaults } from "./providers.mjs";

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

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

/** Kept model refs sorted by provider priority, same order as capability picks. */
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

export async function promptDefaultModel({ settings, plan, order, prompter, log = console.log }) {
  const choices = prioritySortedKept(plan.kept, order);
  const plannedRef =
    plan.next.defaultProvider && plan.next.defaultModel
      ? `${plan.next.defaultProvider}/${plan.next.defaultModel}`
      : null;
  const defIdx = plannedRef ? Math.max(choices.indexOf(plannedRef), 0) : 0;
  let ref;
  if (choices.length === 1) {
    ref = choices[0];
    log(`Phase 3: only one enabled model; default ${ref}`);
  } else {
    const idx = await prompter.askPick("Default model", choices, defIdx);
    ref = choices[idx];
  }
  const prevRef =
    settings?.defaultProvider && settings?.defaultModel
      ? `${settings.defaultProvider}/${settings.defaultModel}`
      : null;
  plan.next.defaultProvider = providerOf(ref);
  plan.next.defaultModel = modelIdOf(ref);
  plan.defaults = {
    defaultProvider: providerOf(ref),
    defaultModel: modelIdOf(ref),
    changed: prevRef !== ref,
  };
}

export async function promptThinkingLevel({ settings, plan, prompter }) {
  const ref = `${plan.next.defaultProvider}/${plan.next.defaultModel}`;
  const existing =
    settings?.modelThinkingLevels?.[ref] ?? settings?.defaultThinkingLevel ?? "low";
  const defIdx = Math.max(THINKING_LEVELS.indexOf(existing), 0);
  const idx = await prompter.askPick(`Thinking level for ${ref}`, THINKING_LEVELS, defIdx);
  const level = THINKING_LEVELS[idx];
  const map = { ...(plan.next.modelThinkingLevels ?? {}) };
  map[ref] = level;
  plan.next.modelThinkingLevels = map;
  plan.thinking = { ref, level };
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
  const nextP = plan.defaults?.defaultProvider;
  const nextM = plan.defaults?.defaultModel;
  if (prevP && prevP === nextP && prevM === nextM) {
    lines.push(`Phase 3: default unchanged (${prevP}/${prevM})`);
  } else if (!prevP && !nextP) {
    lines.push("Phase 3: default (unset)");
  } else if (!prevP) {
    lines.push(`Phase 3: default (unset) -> ${nextP}/${nextM}`);
  } else {
    lines.push(`Phase 3: default ${prevP}/${prevM} -> ${nextP}/${nextM}`);
  }
  if (plan.thinking) {
    lines.push(`Phase 3: thinking ${plan.thinking.ref}=${plan.thinking.level}`);
  }
  return lines.join("\n");
}
