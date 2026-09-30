import { SetupAbort } from "../errors.mjs";
import { filterEnabledModels, resolveDefaults } from "./providers.mjs";

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
