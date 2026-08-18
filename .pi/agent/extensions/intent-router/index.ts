import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { classify, probeClassifier } from "./classify";
import { BLUE, DIM, GREEN, ORANGE, RED } from "./colors";
import { CONFIG_PATH, loadConfig, SAMPLE_CONFIG_PATH } from "./config";
import { isConfirmation, lastAssistantText } from "./context";
import {
	formatDecision,
	modelLabel,
	ROUTE_KEYS,
	type Decision,
	type ModelRef,
} from "./types";

type ColorState = "plain" | "switch" | "restore" | "adv" | "fail";

function sameModel(left: ModelRef | undefined, right: ModelRef): boolean {
	return left?.provider === right.provider && left?.id === right.id;
}

export default function (pi: ExtensionAPI) {
	const fileConfig = loadConfig();
	let enabled = false;
	let lastProbeError: string | undefined;
	let last: { decision: Decision; model: string; prompt: string } | undefined;
	let previousModel: ModelRef | undefined;
	let colorState: ColorState = "plain";

	function statusLine(decision?: Decision, model?: string): string {
		if (!fileConfig) return "intent off (no config)";
		if (!enabled) {
			return lastProbeError && lastProbeError !== "forced off"
				? `intent off (${lastProbeError})`
				: "intent off";
		}
		if (!decision) return lastProbeError ? `intent on (${lastProbeError})` : "intent on";
		return `intent on ${formatDecision(decision)}${model ? ` → ${model}` : ""}`;
	}

	function paint(text: string): string {
		if (colorState === "switch") return GREEN(text);
		if (colorState === "restore") return BLUE(text);
		if (colorState === "adv") return ORANGE(text);
		if (colorState === "fail") return RED(text);
		if (!enabled || !fileConfig) return DIM(text);
		return text;
	}

	function setIndicator(ctx: ExtensionContext, text?: string): void {
		if (!ctx.hasUI) return;
		const line = paint(text ?? statusLine(enabled ? last?.decision : undefined, enabled ? last?.model : undefined));
		// Footer status only; a second widget line would duplicate the indicator.
		ctx.ui.setStatus("intent-router", line);
	}

	async function setRouteModel(ctx: ExtensionContext, target: ModelRef): Promise<string> {
		const found = ctx.modelRegistry.find(target.provider, target.id);
		if (!found) throw new Error(`model not found: ${modelLabel(target)}`);
		if (!sameModel(ctx.model, target)) {
			const ok = await pi.setModel(found);
			if (!ok) throw new Error(`no API key for ${modelLabel(target)}`);
		}
		return modelLabel(target);
	}

	async function applyProbe(ctx: ExtensionContext, notify: boolean): Promise<void> {
		if (!fileConfig) {
			enabled = false;
			lastProbeError = "no config";
			colorState = "plain";
			setIndicator(ctx);
			if (notify) {
				ctx.ui.notify(
					`No config.json. Copy ${SAMPLE_CONFIG_PATH} to ${CONFIG_PATH}`,
					"warning",
				);
			}
			return;
		}
		if (ctx.hasUI) ctx.ui.setStatus("intent-router", "intent probing...");
		const result = await probeClassifier(ctx, fileConfig);
		enabled = result.ok;
		lastProbeError = result.ok ? undefined : result.error;
		colorState = result.ok ? "restore" : "plain";
		setIndicator(ctx);
		if (notify) {
			ctx.ui.notify(
				result.ok ? "intent-router on (classifier probe passed)" : `intent-router off: ${result.error}`,
				result.ok ? "info" : "warning",
			);
		}
		if (notify && fileConfig.migrationNotes.length > 0) {
			ctx.ui.notify(fileConfig.migrationNotes.join("\n"), "warning");
		}
	}

	function startOff(ctx: ExtensionContext): void {
		enabled = false;
		lastProbeError = undefined;
		colorState = "plain";
		setIndicator(ctx);
	}

	pi.on("session_start", async (_event, ctx) => {
		// Fresh chat: off by default. Auto-on only when config.enabled is true.
		if (!fileConfig) {
			lastProbeError = "no config";
			colorState = "plain";
			setIndicator(ctx);
			return;
		}
		if (fileConfig.defaultEnabled) {
			await applyProbe(ctx, ctx.hasUI);
			return;
		}
		startOff(ctx);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (!enabled || !fileConfig) return;
		const prompt = event.prompt.trim();
		if (!prompt || prompt.startsWith("/")) return;
		try {
			if (ctx.hasUI) ctx.ui.setStatus("intent-router", "intent routing...");
			const prior = lastAssistantText(ctx);
			const decision = isConfirmation(prompt) && prior
				? {
						kind: "instruction" as const,
						needsCurrentThread: true,
						includesEnglish: false,
						key: "question" as const,
				  }
				: await classify(ctx, fileConfig, prompt, prior, ctx.signal);
			const current = ctx.model ? modelLabel(ctx.model) : "current";
			const skipEnglish =
				decision.includesEnglish && !decision.needsCurrentThread;
			const target =
				!decision.needsCurrentThread && !skipEnglish
					? fileConfig.routes[decision.key]
					: undefined;
			if (!target) {
				last = { decision, model: current, prompt };
				previousModel = undefined;
				colorState = "restore";
				setIndicator(ctx, statusLine(decision, current));
				ctx.ui.notify(`${formatDecision(decision)} → ${current}`, "info");
				return;
			}
			previousModel = ctx.model && !sameModel(ctx.model, target)
				? { provider: ctx.model.provider, id: ctx.model.id }
				: undefined;
			const model = await setRouteModel(ctx, target);
			last = { decision, model, prompt };
			colorState = decision.key.endsWith(".adv") ? "adv" : "switch";
			setIndicator(ctx, statusLine(decision, model));
			ctx.ui.notify(`${formatDecision(decision)} → ${model}`, "info");
		} catch (error) {
			previousModel = undefined;
			colorState = "fail";
			const message = error instanceof Error ? error.message : String(error);
			setIndicator(ctx, "intent fail-open");
			ctx.ui.notify(`intent-router kept current model: ${message}`, "warning");
		}
	});

	pi.on("agent_settled", async (_event, ctx) => {
		if (!previousModel) return;
		const restore = previousModel;
		previousModel = undefined;
		try {
			const model = await setRouteModel(ctx, restore);
			colorState = "restore";
			setIndicator(ctx, `intent restored ${model}`);
			ctx.ui.notify(`intent-router restored ${model}`, "info");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (ctx.hasUI) ctx.ui.notify(`intent-router restore failed: ${message}`, "warning");
		}
	});

	pi.registerCommand("intent", {
		description: "Toggle or inspect per-message model routing",
		getArgumentCompletions: (prefix: string) =>
			["on", "off", "probe", "last", "routes"]
				.filter((item) => item.startsWith(prefix.toLowerCase()))
				.map((item) => ({ value: item, label: item })),
		handler: async (args, ctx) => {
			const sub = args.trim().toLowerCase().split(/\s+/)[0] || "";
			if (!sub) {
				// Bare /intent toggles: off -> probe on, on -> off.
				if (enabled) {
					startOff(ctx);
					ctx.ui.notify("intent off. /intent on to enable.", "info");
				} else {
					await applyProbe(ctx, true);
				}
				return;
			}
			if (sub === "on" || sub === "probe") {
				await applyProbe(ctx, true);
				return;
			}
			if (sub === "off") {
				startOff(ctx);
				ctx.ui.notify("intent off. /intent on to enable.", "info");
				return;
			}
			if (sub === "routes") {
				if (!fileConfig) {
					ctx.ui.notify(
						`No config.json. Copy ${SAMPLE_CONFIG_PATH} to ${CONFIG_PATH}`,
						"warning",
					);
					return;
				}
				const lines = ROUTE_KEYS.map((key) => {
					const target = fileConfig.routes[key];
					return `${key} → ${target ? modelLabel(target) : "current session model"}`;
				});
				ctx.ui.notify(
					[
						`classifier → ${modelLabel(fileConfig.classifier)}`,
						"restore → previous session model",
						...lines,
						`config: ${CONFIG_PATH}`,
					].join("\n"),
					"info",
				);
				return;
			}
			if (sub === "last") {
				if (!last) {
					ctx.ui.notify("No classification yet this session.", "warning");
					return;
				}
				ctx.ui.notify(`${formatDecision(last.decision)} → ${last.model}`, "info");
				return;
			}
			ctx.ui.notify(
				[
					statusLine(last?.decision, last?.model),
					"Usage: /intent toggles. /intent on|off|probe|last|routes subcommands.",
					fileConfig
						? "Fresh chats start off unless config.enabled is true. /intent on probes and enables."
						: `Copy ${SAMPLE_CONFIG_PATH} to ${CONFIG_PATH} to enable.`,
				].join("\n"),
				"info",
			);
		},
	});
}
