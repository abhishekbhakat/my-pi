import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { checkCliStatus, setupGuidance, vibeBin, type CliStatus } from "./cli.ts";
import { API_ID, configuredModels, PROVIDER_ID, providerModels, type VibeCliModelInfo } from "./models.ts";
import { streamVibeCli } from "./stream.ts";

export { PROVIDER_ID } from "./models.ts";
export { configuredModels } from "./models.ts";
export { buildVibeArgs, vibeEnv } from "./cli.ts";
export { buildPrompt, parseJsonOutput, parseToolCalls } from "./prompt.ts";

let registeredModels: VibeCliModelInfo[] = configuredModels(process.env.MISTRAL_VIBE_CLI_MODELS);
let lastCliStatus: CliStatus | undefined;

function registerVibeProvider(pi: ExtensionAPI) {
	pi.registerProvider(PROVIDER_ID, {
		name: "Mistral Vibe CLI",
		baseUrl: "cli:vibe-p",
		apiKey: "mistral-vibe-cli-no-api-key",
		api: API_ID,
		models: providerModels(registeredModels),
		streamSimple: streamVibeCli,
	});
}

function statusLines(status?: CliStatus): string[] {
	const lines = [
		`Provider: ${PROVIDER_ID}`,
		`Vibe binary: ${vibeBin()}`,
		"Transport: local `vibe -p` per model turn; stateless, full transcript each turn",
		"Vibe tools: disabled via --enabled-tools __none__; Pi executes all tools",
		"Fallbacks: none (no Mistral HTTP API or built-in Mistral provider)",
		"Images: not supported (vibe -p has no image input)",
		`Registered models: ${registeredModels.length}`,
	];

	const current = status ?? lastCliStatus;
	if (current) {
		lines.push(`CLI status: ${current.ok ? "ok" : "error"} — ${current.summary}`);
		if (current.detail) lines.push(`CLI detail: ${current.detail}`);
	} else {
		lines.push("CLI status: run /mistral-vibe-cli status to check `vibe --version`.");
	}

	lines.push("");
	for (const model of registeredModels) lines.push(`  - ${PROVIDER_ID}/${model.id} — ${model.name}`);
	lines.push("");
	lines.push("Quick test:");
	lines.push(`  pi -p --provider ${PROVIDER_ID} --model ${registeredModels[0]?.id ?? "default"} "Reply with exactly OK"`);
	return lines;
}

export default function mistralVibeCliExtension(pi: ExtensionAPI) {
	registeredModels = configuredModels(process.env.MISTRAL_VIBE_CLI_MODELS);
	registerVibeProvider(pi);

	pi.on("session_start", async (_event: any, ctx: any) => {
		lastCliStatus = await checkCliStatus();
		if (!lastCliStatus.ok) {
			ctx.ui.notify(`mistral-vibe-cli: ${setupGuidance(lastCliStatus.detail ?? lastCliStatus.summary)}`, "warning");
		}
	});

	pi.registerCommand("mistral-vibe-cli", {
		description: "Mistral Vibe CLI provider status and setup help",
		handler: async (args: string, ctx: any) => {
			const sub = args.trim().split(/\s+/).filter(Boolean)[0] ?? "status";
			if (sub === "status") {
				lastCliStatus = await checkCliStatus();
				for (const line of statusLines(lastCliStatus)) ctx.ui.notify(line, lastCliStatus.ok ? "info" : "warning");
				return;
			}
			if (sub === "models") {
				for (const model of registeredModels) ctx.ui.notify(`${PROVIDER_ID}/${model.id} — ${model.name}`, "info");
				ctx.ui.notify('Override with MISTRAL_VIBE_CLI_MODELS="default,glm-5.3" (Vibe config aliases)', "info");
				return;
			}
			if (sub === "help") {
				ctx.ui.notify("Usage: /mistral-vibe-cli [status|models|help]", "info");
				ctx.ui.notify("Set MISTRAL_VIBE_CLI_BIN to override the vibe executable.", "info");
				ctx.ui.notify("Set MISTRAL_VIBE_CLI_MODELS for comma-separated Vibe model aliases (default always available).", "info");
				ctx.ui.notify("Set MISTRAL_VIBE_CLI_TIMEOUT_MS / MISTRAL_VIBE_CLI_CONTEXT_WINDOW to tune the bridge.", "info");
				return;
			}
			ctx.ui.notify(`Unknown /mistral-vibe-cli subcommand: ${sub}. Try /mistral-vibe-cli help`, "warning");
		},
	});
}
