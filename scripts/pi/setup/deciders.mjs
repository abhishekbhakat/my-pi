import fs from "node:fs";
import path from "node:path";
import { exists } from "../fs/read-write.mjs";
import { SetupAbort } from "../errors.mjs";

export const DECIDER_ROLES = ["booleanGuy", "prune", "compaction", "guard"];

const ENV_KEYS = {
  typesafe: ["TYPESAFE_API_KEY"],
  "opencode-zen": ["OPENCODE_ZEN_API_KEY"],
  cloudflare: ["CLOUDFLARE_AUTH_TOKEN", "CLOUDFLARE_API_TOKEN"],
  perplexity: ["PERPLEXITY_API_KEY", "PPLX_API_KEY"],
  fastino: ["FASTINO_API_KEY"],
};

export function loadDecidersRegistry(agentDir) {
  const p = path.join(agentDir, "deciders.json");
  if (!exists(p)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!raw || typeof raw !== "object") throw new Error("must be an object");
    if (!raw.providers || !raw.models || !raw.roles) throw new Error("missing providers/models/roles");
    return raw;
  } catch (error) {
    throw new SetupAbort(`${p}: ${error.message}`);
  }
}

// Providers with a public free-tier fallback key baked into the decider module.
const FALLBACK_PROVIDERS = new Set(["opencode-zen"]);

function authKeyAvailable(auth, authProvider) {
  if (FALLBACK_PROVIDERS.has(authProvider)) return true;
  for (const name of ENV_KEYS[authProvider] ?? []) {
    if (process.env[name]?.trim()) return true;
  }
  const entry = auth?.[authProvider];
  return Boolean(
    entry
      && typeof entry === "object"
      && !Array.isArray(entry)
      && entry.type !== "oauth"
      && typeof entry.key === "string"
      && entry.key.trim() !== "",
  );
}

export async function resolveDeciderTargets({ registry, auth, prompter, log = console.log }) {
  const models = Array.isArray(registry.models) ? registry.models : [];
  if (!models.length) throw new SetupAbort("deciders.json has no models");
  const keyAvailable = new Map();
  for (const model of models) {
    const provider = registry.providers?.[model.provider];
    const authProvider = provider?.authProvider ?? model.provider;
    if (!keyAvailable.has(authProvider)) {
      keyAvailable.set(authProvider, authKeyAvailable(auth, authProvider));
    }
  }

  const choices = models.map((model) => {
    const provider = registry.providers?.[model.provider];
    const authProvider = provider?.authProvider ?? model.provider;
    const suffix = keyAvailable.get(authProvider) ? "" : " (no key)";
    return `${model.id}${suffix}`;
  });
  const choiceIds = models.map((model) => model.id);

  log("Phase 5: decision models (boolean guy, pruning, guards).");
  const roles = {};
  for (const role of DECIDER_ROLES) {
    const current = registry.roles?.[role];
    const currentId = Array.isArray(current) ? current[0] : current;
    const def = Math.max(0, choiceIds.indexOf(currentId));
    const label = `Decider for ${role} (current ${currentId ?? "unset"})`;
    const idx = await prompter.askPick(label, choices, def, { printChoices: role === "booleanGuy" });
    roles[role] = choiceIds[idx];
  }

  const keys = new Map();
  const missing = [...keyAvailable.entries()].filter(([, ok]) => !ok).map(([name]) => name);
  for (const authProvider of missing) {
    const want = await prompter.askYesNo(`Add API key for decider provider ${authProvider} now?`);
    if (!want) continue;
    const key = await prompter.askSecret(`${authProvider} API key: `);
    if (key) keys.set(authProvider, key);
  }

  let cloudflareAccountId;
  if (roles.booleanGuy.startsWith("cloudflare/") || roles.prune.startsWith("cloudflare/")
    || roles.compaction.startsWith("cloudflare/") || roles.guard.startsWith("cloudflare/")) {
    cloudflareAccountId = await prompter.askSecret("Cloudflare account ID: ");
  }

  return { roles, keys, cloudflareAccountId };
}

export function applyDeciderPlan(registry, plan) {
  const next = {
    providers: registry.providers,
    models: registry.models,
    roles: { ...registry.roles, ...plan.roles },
  };
  if (plan.cloudflareAccountId) {
    next.providers = {
      ...registry.providers,
      cloudflare: {
        ...registry.providers.cloudflare,
        accountId: plan.cloudflareAccountId,
      },
    };
  }
  return `${JSON.stringify(next, null, 2)}\n`;
}

export function describeDeciderPlan(plan) {
  const roles = DECIDER_ROLES.map((role) => `${role}=${plan.roles[role]}`).join("; ");
  const keys = plan.keys.size ? `new keys: ${[...plan.keys.keys()].join(",")}` : "new keys: (none)";
  return `Phase 5: ${roles}; ${keys}`;
}
