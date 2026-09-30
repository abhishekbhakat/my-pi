export function isOauthEntry(value) {
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

export function providerOf(ref) {
  if (typeof ref !== "string") return "";
  const slash = ref.indexOf("/");
  if (slash <= 0) return "";
  return ref.slice(0, slash);
}

export function modelIdOf(ref) {
  if (typeof ref !== "string") return "";
  const slash = ref.indexOf("/");
  if (slash <= 0) return "";
  return ref.slice(slash + 1);
}

export function firstByPriority(keptModels, orderedProviders) {
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

export function hasApiKey(entry) {
  return Boolean(
    entry
    && typeof entry === "object"
    && !Array.isArray(entry)
    && entry.type !== "oauth"
    && typeof entry.key === "string"
    && entry.key.trim() !== "",
  );
}
