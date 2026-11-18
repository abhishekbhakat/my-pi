import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";

const EXTENSION_ID = "fast-mode";
const CONFIG_NAME = "openai-fast.json";
const TIER = "priority";
const FAST_TIER_KEY = Symbol.for("my-pi.fast-mode.service-tier");

type FastConfig = { enabled: boolean; showStatus: boolean };
const DEFAULT: FastConfig = { enabled: false, showStatus: true };

function configPath(): string {
	return join(getAgentDir(), "extensions", CONFIG_NAME);
}

function readConfig(): FastConfig {
	const path = configPath();
	if (!existsSync(path)) return { ...DEFAULT };
	try {
		const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<FastConfig>;
		return {
			enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT.enabled,
			showStatus: typeof parsed.showStatus === "boolean" ? parsed.showStatus : DEFAULT.showStatus,
		};
	} catch (error) {
		console.error(`Warning: Could not parse ${path}: ${error}`);
		return { ...DEFAULT };
	}
}

export default function fastModeExtension(pi: ExtensionAPI) {
	let config = readConfig();
	const requestedTier = (provider?: string) => config.enabled && provider === "openai" ? TIER : undefined;
	// Capability calls send requests directly, outside the session's payload hook.
	const shared = globalThis as typeof globalThis & { [FAST_TIER_KEY]?: typeof requestedTier };
	shared[FAST_TIER_KEY] = requestedTier;

	function updateStatus(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		ctx.ui.setStatus(EXTENSION_ID, config.showStatus && config.enabled ? "fast" : undefined);
	}

	function statusMessage(ctx: ExtensionContext): string {
		if (!config.enabled) return "OpenAI Fast mode is off.";
		if (requestedTier(ctx.model?.provider)) {
			return "OpenAI Fast mode is on. This session requests service_tier=priority; the server determines the actual tier.";
		}
		return "OpenAI Fast mode is on. This session is outside Fast scope. Only openai requests, including capability calls, use priority.";
	}

	pi.on("session_start", (_event, ctx) => {
		config = readConfig();
		shared[FAST_TIER_KEY] = requestedTier;
		updateStatus(ctx);
	});
	pi.on("session_shutdown", () => {
		if (shared[FAST_TIER_KEY] === requestedTier) delete shared[FAST_TIER_KEY];
	});
	pi.on("before_provider_request", (event, ctx) => {
		const tier = requestedTier(ctx.model?.provider);
		if (!tier || !event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) return;
		return { ...event.payload, service_tier: tier };
	});

	pi.registerCommand("fast", {
		description: "Toggle OpenAI priority tier",
		getArgumentCompletions: (prefix) =>
			["on", "off", "status"].filter((item) => item.startsWith(prefix.toLowerCase())).map((item) => ({ value: item, label: item })),
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase();
			if (action && action !== "status" && action !== "on" && action !== "off") {
				ctx.ui.notify("Usage: /fast [on|off|status]", "warning");
				return;
			}
			const current = readConfig();
			if (action === "status") {
				config = current;
			} else {
				const next = { ...current, enabled: action === "on" || (action === "" && !current.enabled) };
				writeFileSync(configPath(), `${JSON.stringify(next, null, 2)}\n`);
				config = next;
			}
			updateStatus(ctx);
			ctx.ui.notify(statusMessage(ctx), "info");
		},
	});
}
