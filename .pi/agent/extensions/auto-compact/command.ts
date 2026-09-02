/**
 * /autocompact command: toggle, status, threshold, force, save, reload.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	configPath,
	MAX_THRESHOLD,
	MIN_THRESHOLD,
	readConfig,
	writeConfig,
	type AutoCompactConfig,
} from "./config";
import { forceCompact, maybeCompact } from "./compactor";
import {
	effectiveConfig,
	notifyStatus,
	rememberCtx,
	type SessionRuntime,
} from "./runtime";

export function registerCommand(pi: ExtensionAPI, rt: SessionRuntime): void {
	pi.registerCommand("autocompact", {
		description: "Toggle auto-compact. Usage: /autocompact [status|on|off|now|save|NN]",
		handler: async (args, ctx) => {
			rememberCtx(rt, ctx);
			const raw = args.trim().toLowerCase();

			if (!raw) {
				const next = !effectiveConfig(rt).enabled;
				rt.sessionEnabled = next;
				if (next) {
					notifyStatus(
						rt,
						ctx,
						`auto-compact on @ ${effectiveConfig(rt).thresholdPercent}% (session)`,
					);
					maybeCompact(ctx, effectiveConfig(rt), rt.state, "command");
				} else {
					notifyStatus(rt, ctx, "auto-compact off (session)");
				}
				return;
			}

			if (raw === "status") {
				notifyStatus(rt, ctx);
				return;
			}

			if (raw === "on") {
				rt.sessionEnabled = true;
				notifyStatus(
					rt,
					ctx,
					`auto-compact on @ ${effectiveConfig(rt).thresholdPercent}% (session)`,
				);
				maybeCompact(ctx, effectiveConfig(rt), rt.state, "command");
				return;
			}

			if (raw === "off") {
				rt.sessionEnabled = false;
				notifyStatus(rt, ctx, "auto-compact off (session)");
				return;
			}

			if (raw === "now") {
				forceCompact(ctx, effectiveConfig(rt), rt.state);
				return;
			}

			if (raw === "save") {
				const next: AutoCompactConfig = {
					...rt.config,
					enabled: rt.sessionEnabled ?? rt.config.enabled,
					thresholdPercent: rt.sessionThreshold ?? rt.config.thresholdPercent,
				};
				writeConfig(next);
				rt.config = next;
				rt.sessionEnabled = undefined;
				rt.sessionThreshold = undefined;
				notifyStatus(rt, ctx, `Saved to ${configPath()}`);
				return;
			}

			if (raw === "reload") {
				rt.config = readConfig();
				rt.sessionEnabled = undefined;
				rt.sessionThreshold = undefined;
				notifyStatus(rt, ctx, `Reloaded ${configPath()}`);
				return;
			}

			const n = Number(raw);
			if (Number.isFinite(n) && n >= MIN_THRESHOLD && n <= MAX_THRESHOLD) {
				rt.sessionThreshold = Math.round(n);
				rt.sessionEnabled = true;
				notifyStatus(
					rt,
					ctx,
					`auto-compact on @ ${rt.sessionThreshold}% (session). /autocompact save to persist.`,
				);
				maybeCompact(ctx, effectiveConfig(rt), rt.state, "command");
				return;
			}

			if (ctx.hasUI) {
				ctx.ui.notify(
					`Usage: /autocompact (toggle) | status|on|off|now|save|reload|${MIN_THRESHOLD}-${MAX_THRESHOLD}`,
					"warning",
				);
			}
		},
	});
}
