import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";

const EXTENSION_ID = "yolo";
const CONFIG_NAME = "yolo.json";
const YOLO_KEY = Symbol.for("my-pi.yolo.enabled");

type YoloConfig = { enabled: boolean };

const DEFAULT: YoloConfig = { enabled: false };

function configPath(): string {
	return join(getAgentDir(), "extensions", CONFIG_NAME);
}

function readConfig(): YoloConfig {
	const path = configPath();
	if (!existsSync(path)) return { ...DEFAULT };
	try {
		const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<YoloConfig>;
		return { enabled: parsed.enabled === true };
	} catch (error) {
		console.error(`Warning: Could not parse ${path}: ${error}`);
		return { ...DEFAULT };
	}
}

function applyConfig(config: YoloConfig): boolean {
	const g = globalThis as typeof globalThis & { [YOLO_KEY]?: boolean };
	g[YOLO_KEY] = config.enabled;
	return config.enabled;
}

export function isYoloEnabled(): boolean {
	const g = globalThis as typeof globalThis & { [YOLO_KEY]?: boolean };
	if (typeof g[YOLO_KEY] === "boolean") return g[YOLO_KEY] as boolean;
	return applyConfig(readConfig());
}

function updateStatus(ctx: ExtensionContext, enabled: boolean): void {
	if (!ctx.hasUI) return;
	ctx.ui.setStatus(EXTENSION_ID, enabled ? "yolo" : "\x1b[2myolo\x1b[22m");
}

function statusMessage(enabled: boolean): string {
	return enabled
		? "YOLO mode is ON: damage-control blocking is disabled. All tool calls are allowed. Run /yolo off to re-enable guardrails."
		: "YOLO mode is OFF: damage-control blocking is enabled.";
}

export function registerYoloCommand(pi: ExtensionAPI): void {
	applyConfig(readConfig());

	pi.on("session_start", (_event, ctx) => {
		updateStatus(ctx, applyConfig(readConfig()));
	});

	pi.registerCommand("yolo", {
		description: "Toggle YOLO mode (damage-control guardrails on/off)",
		getArgumentCompletions: (prefix) =>
			["on", "off", "status"].filter((item) => item.startsWith(prefix.toLowerCase())).map((item) => ({ value: item, label: item })),
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase();
			const config = readConfig();
			if (action === "status") {
				ctx.ui.notify(statusMessage(applyConfig(config)), "info");
				return;
			}
			if (action && action !== "on" && action !== "off") {
				ctx.ui.notify("Usage: /yolo [on|off|status]", "warning");
				return;
			}
			const enabled = action === "on" ? true : action === "off" ? false : !config.enabled;
			const next: YoloConfig = { enabled };
			writeFileSync(configPath(), `${JSON.stringify(next, null, 2)}\n`);
			applyConfig(next);
			updateStatus(ctx, enabled);
			ctx.ui.notify(statusMessage(enabled), enabled ? "warning" : "info");
		},
	});
}
