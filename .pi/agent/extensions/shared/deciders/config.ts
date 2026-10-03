/**
 * Decider registry and auth resolution. Reads .pi/agent/deciders.json and
 * .pi/agent/auth.json. Falls back to built-in defaults that preserve the
 * pre-registry hardcoded Jev behavior.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { DeciderModelConfig, DeciderProviderConfig, DeciderRegistry } from "./types.ts";

export const DEFAULT_REGISTRY: DeciderRegistry = {
	providers: {
		"opencode-zen": {
			adapter: "systemone",
			baseUrl: "https://opencode.ai/zen/v1/systemone",
			authProvider: "opencode-zen",
			authHeader: "bearer",
		},
		typesafe: {
			adapter: "systemone",
			baseUrl: "https://api.typesafe.ai/v1/systemone",
			authProvider: "typesafe",
			authHeader: "bearer",
		},
	},
	models: [
		{
			id: "opencode-zen/jev-1.13-free",
			provider: "opencode-zen",
			model: "jev-1.13-free",
			kinds: ["noul", "choice", "score"],
			maxQuestions: 16,
			timeoutMs: 0,
		},
		{
			id: "typesafe/jev-latest",
			provider: "typesafe",
			model: "jev-latest",
			kinds: ["noul", "choice", "score"],
			maxQuestions: 16,
			timeoutMs: 10_000,
		},
	],
	roles: {
		booleanGuy: "opencode-zen/jev-1.13-free",
		prune: "opencode-zen/jev-1.13-free",
		compaction: "typesafe/jev-latest",
		guard: "opencode-zen/jev-1.13-free",
	},
};

export function agentDir(): string {
	const configured = process.env.PI_CODING_AGENT_DIR?.trim();
	if (!configured) return join(homedir(), ".pi", "agent");
	return isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
}

function readJson(path: string): unknown {
	if (!existsSync(path)) return undefined;
	try {
		return JSON.parse(readFileSync(path, "utf8")) as unknown;
	} catch {
		return undefined;
	}
}

export function loadRegistry(): DeciderRegistry {
	const raw = readJson(join(agentDir(), "deciders.json"));
	if (!raw || typeof raw !== "object") return DEFAULT_REGISTRY;
	const registry = raw as Partial<DeciderRegistry>;
	if (!registry.providers || !registry.models || !registry.roles) return DEFAULT_REGISTRY;
	return {
		providers: registry.providers,
		models: registry.models,
		roles: registry.roles,
	};
}

export function modelsForRole(registry: DeciderRegistry, role: string): DeciderModelConfig[] {
	const value = registry.roles[role];
	const ids = Array.isArray(value) ? value : value ? [value] : [];
	const byId = new Map(registry.models.map((model) => [model.id, model]));
	const out: DeciderModelConfig[] = [];
	for (const id of ids) {
		const model = byId.get(id);
		if (model) out.push(model);
	}
	return out;
}

const ENV_KEYS: Record<string, string[]> = {
	typesafe: ["TYPESAFE_API_KEY"],
	"opencode-zen": ["OPENCODE_ZEN_API_KEY"],
	cloudflare: ["CLOUDFLARE_AUTH_TOKEN", "CLOUDFLARE_API_TOKEN"],
	perplexity: ["PERPLEXITY_API_KEY", "PPLX_API_KEY"],
	fastino: ["FASTINO_API_KEY"],
};

/**
 * Free-tier keys shared publicly with this repo so fresh clones work with
 * zero setup. Personal keys from auth.json or env vars always win.
 */
const FALLBACK_KEYS: Record<string, string> = {
	"opencode-zen": "oc_sk_fdd63615fdd6_y_iZWGTiX3fdj2GtkOxZRKCiaQ5NU_XC",
};

export function resolveKey(authProvider: string): string | undefined {
	for (const name of ENV_KEYS[authProvider] ?? []) {
		const value = process.env[name]?.trim();
		if (value) return value;
	}
	const genericName = `DECIDER_${authProvider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
	const generic = process.env[genericName]?.trim();
	if (generic) return generic;
	const auth = readJson(join(agentDir(), "auth.json")) as Record<string, unknown> | undefined;
	const entry = auth?.[authProvider];
	if (entry && typeof entry === "object" && !Array.isArray(entry)) {
		const record = entry as { type?: unknown; key?: unknown };
		if (record.type !== "oauth" && typeof record.key === "string" && record.key.trim()) {
			return record.key.trim();
		}
	}
	// Legacy: the TypeSafe key used to live in the skill auth file.
	if (authProvider === "typesafe") {
		const legacy = readJson(join(agentDir(), "skills", "typesafe-ai", "typesafe-auth.json")) as
			| { api_key?: unknown }
			| undefined;
		const key = legacy?.api_key;
		if (typeof key === "string" && key.trim() && key !== "YOUR_TYPESAFE_API_KEY") return key.trim();
	}
	// Free-tier OpenCode Zen key, intentionally public so fresh clones work
	// with zero setup. Personal keys from auth.json or env always win.
	return FALLBACK_KEYS[authProvider];
}

export function providerFor(registry: DeciderRegistry, model: DeciderModelConfig): DeciderProviderConfig | undefined {
	return registry.providers[model.provider];
}

export function accountIdFor(provider: DeciderProviderConfig): string | undefined {
	return process.env.CLOUDFLARE_ACCOUNT_ID?.trim() || provider.accountId?.trim() || undefined;
}
