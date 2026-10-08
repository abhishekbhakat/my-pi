import { SetupAbort } from "../errors.mjs";
import {
  classifyProvider,
  hasApiKey,
  isOauthEntry,
  providerBaseUrl,
} from "./providers.mjs";

function openRouterKeyPresent(auth, staged) {
  if (staged.apiKeys.has("openrouter")) return true;
  if (hasApiKey(auth?.openrouter)) return true;
  if (process.env.CLAUDE_CODE_PI_MORPH_API_KEY?.trim()) return true;
  if (process.env.OPENROUTER_API_KEY?.trim()) return true;
  return false;
}

/**
 * claude-code-pi Morph tool-call repair calls OpenRouter (morph/morph-v3-fast).
 * Require a key whenever Claude Code CLI models are enabled, even if the user
 * declined enabling openrouter as a chat provider.
 */
export async function ensureOpenRouterForMorph({
  wantClaude,
  auth,
  staged,
  prompter,
  log = console.log,
}) {
  if (!wantClaude) return;
  log("Why OpenRouter: claude -p sometimes emits broken tool XML (e.g. missing <function_calls>).");
  log("Pi then cannot run tools. Morph (morph/morph-v3-fast via OpenRouter) rewrites that XML once.");
  log("This is not for chat models; it is only the claude-code-pi tool-call repair path.");
  if (openRouterKeyPresent(auth, staged)) {
    log("Morph repair: OpenRouter key already present — ok.");
    return;
  }
  log("Get a key at https://openrouter.ai/keys — required even if you skip openrouter chat models.");
  const secret = await prompter.askSecret("OpenRouter API key for Morph tool-call repair: ");
  if (!secret) {
    throw new SetupAbort(
      "OpenRouter API key required when enabling claude-code-cli: without it Morph cannot fix broken tool XML. Re-run setup or set OPENROUTER_API_KEY.",
    );
  }
  staged.apiKeys.set("openrouter", secret);
  log("Morph repair: OpenRouter key saved to auth.json on persist.");
}

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

  await ensureOpenRouterForMorph({ wantClaude, auth, staged, prompter, log });
  return staged;
}
