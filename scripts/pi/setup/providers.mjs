export function isOauthEntry(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && value.type === "oauth");
}

export const PROVIDER_PRIORITY = [
  "google",
  "anthropic",
  "opencode-go",
  "mistral-vibe-cli",
  "openai",
  "openrouter",
  "kimi-coding",
  "grok-cli",
  "refuseless",
];

// API keys setup can read from the environment instead of prompting.
export const PROVIDER_ENV_KEYS = { refuseless: ["REFUSELESS_API_KEY"] };

// Local CLI bridges: no API key in setup; auth is the CLI login on PATH.
export const CLI_PROVIDERS = new Set(["mistral-vibe-cli"]);
// Login via /login in pi; setup never prompts for a key.
export const OAUTH_PROVIDERS = new Set(["openai", "kimi-coding", "grok-cli", "muse"]);
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
export const CAPABILITY_PREFERRED = {
  timeline: "anthropic/claude-haiku-5-5",
  scout: "anthropic/claude-haiku-5-5",
  commit: "anthropic/claude-haiku-5-5",
  coach: "anthropic/claude-opus-5-5",
  reviewer: "anthropic/claude-opus-5-5",
  coder: "anthropic/claude-opus-5-5",
};

export const CAP_ROLES = Object.keys(CAPABILITY_PREFERRED);
const CAP_MODEL_RE = /^[A-Za-z0-9._-]+\/[^\s"'\\`$]+$/;

export function parseCapabilityTarget(value) {
  const object = value && typeof value === "object" && !Array.isArray(value);
  const model = typeof value === "string" ? value : object ? value.model : null;
  if (typeof model !== "string" || !CAP_MODEL_RE.test(model)) return null;
  if (object && Object.keys(value).some((key) => key !== "model" && key !== "reasoningEffort")) return null;
  if (object && Object.hasOwn(value, "reasoningEffort")) {
    if (!THINKING_LEVELS.includes(value.reasoningEffort)) return null;
    return { model, reasoningEffort: value.reasoningEffort };
  }
  return { model };
}

export function inheritCapabilityTargets(targets) {
  return !Object.hasOwn(targets, "commit") && Object.hasOwn(targets, "scout")
    ? { ...targets, commit: targets.scout }
    : targets;
}

/** Catalog metadata fills missing fields; models.json definitions and overrides take precedence. */
export function supportedThinkingLevels(ref, models = {}, catalog = {}) {
  const providerId = providerOf(ref);
  // pi-muse-provider wraps Pi core's built-in meta models; neither muse
  // in models.json nor `muse` in the catalog exist, so fall back to meta.
  const catalogProviderId = providerId === "muse" ? "meta" : providerId;
  const provider = models?.providers?.[providerId];
  const id = modelIdOf(ref);
  const custom = provider?.models?.find((model) => model.id === id);
  const cachedModels = catalog?.[catalogProviderId]?.models;
  const cached = Array.isArray(cachedModels) ? cachedModels.find((model) => model?.id === id) : undefined;
  const override = provider?.modelOverrides?.[id];
  const reasoning = override?.reasoning ?? custom?.reasoning ?? cached?.reasoning;
  const map = {
    ...(custom?.thinkingLevelMap ?? cached?.thinkingLevelMap),
    ...override?.thinkingLevelMap,
  };
  if (reasoning === false) return ["off"];
  const levels = THINKING_LEVELS.filter((level) => {
    const mapped = map?.[level];
    if (mapped === null) return false;
    return level === "xhigh" || level === "max" ? mapped !== undefined : true;
  });
  return levels.length ? levels : ["off"];
}

/** Keep unsupported defaults at the highest supported level not above the request. */
export function thinkingLevelDefaultIndex(levels, requested) {
  const exact = levels.indexOf(requested);
  if (exact >= 0) return exact;
  for (let i = THINKING_LEVELS.indexOf(requested); i >= 0; i -= 1) {
    const index = levels.indexOf(THINKING_LEVELS[i]);
    if (index >= 0) return index;
  }
  return 0;
}

export function formatCapabilityTargets(targets) {
  return CAP_ROLES.filter((role) => Object.hasOwn(targets, role)).map((role) => {
    const value = parseCapabilityTarget(targets[role]);
    return `${role}=${value ? value.model + (value.reasoningEffort ? "@" + value.reasoningEffort : "") : "(invalid)"}`;
  }).join("; ");
}

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

/** @returns {"cli"|"oauth"|"apikey"} */
export function classifyProvider(provider, auth = {}) {
  if (CLI_PROVIDERS.has(provider)) return "cli";
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
