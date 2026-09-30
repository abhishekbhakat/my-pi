import {
  classifyProvider,
  hasApiKey,
  isOauthEntry,
  providerBaseUrl,
} from "./providers.mjs";

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
