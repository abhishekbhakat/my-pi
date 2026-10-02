/**
 * Token Speed - footer extension.
 *
 * Replaces default footer with same content plus `TOK/s : <rate>` right-aligned
 * at the very right corner of the pwd line.
 *
 * Rate = last assistant message output tokens / seconds from message_start
 * to message_end. Tool time between messages is not included. Blank until
 * the first reply after load.
 *
 * The mistral-vibe-cli bridge publishes a provider-reported generation rate
 * per turn; when that entry is fresher than the local timer window, it wins,
 * because the wall clock there includes spawn and parse overhead.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const LABEL = "TOK/s";
const MIN_PAD = 2;
const MIN_MS = 50;

// mistral-vibe-cli publishes provider-reported tok/s here per turn
// (mistral-vibe-cli/stats.ts). Symbol.for shares the registry key.
const TURN_STATS_KEY = Symbol.for("my-pi.vibe.turn-stats");

function sharedRate(): { rate: number; at: number } | undefined {
	const g = globalThis as typeof globalThis & { [TURN_STATS_KEY]?: { rate: number; at: number } };
	const shared = g[TURN_STATS_KEY];
	return shared && Number.isFinite(shared.rate) && shared.rate > 0 ? shared : undefined;
}

interface Usage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

function emptyUsage(): Usage {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
}

function add(into: Usage, u: Usage): void {
	into.input += u.input;
	into.output += u.output;
	into.cacheRead += u.cacheRead;
	into.cacheWrite += u.cacheWrite;
	into.cost += u.cost;
}

/** pwd line: cwd (branch) left, speed pinned to the right edge. Speed drops when too narrow. */
function renderPwdLine(theme: any, cwd: string, branch: string | null, speedText: string, width: number): string {
	let left = branch ? `${cwd} (${branch})` : cwd;
	if (!speedText) return truncateToWidth(theme.fg("dim", left), width, "...");
	const rightW = visibleWidth(speedText);
	if (visibleWidth(left) + MIN_PAD + rightW > width) {
		left = truncateToWidth(left, Math.max(0, width - rightW - MIN_PAD), "...");
	}
	const pad = " ".repeat(Math.max(MIN_PAD, width - visibleWidth(left) - rightW));
	return truncateToWidth(theme.fg("dim", left) + pad + theme.fg("accent", speedText), width, "...");
}

export default function (pi: ExtensionAPI) {
	let enabled = true;
	let ui: any = null;
	let startedAt: number | null = null;
	let rate: number | null = null;

	const install = (ctx: any) => {
		ui = ctx.ui;
		ctx.ui.setFooter((tui: any, theme: any, footerData: any) => {
			const unsubBranch = footerData.onBranchChange(() => tui.requestRender());
			return {
				dispose: unsubBranch,
				invalidate() {},
				render(width: number): string[] {
					const entries = ctx.sessionManager.getBranch();
					const totals = emptyUsage();
					let hitRate: number | undefined;
					for (const e of entries) {
						if (e.type === "message" && (e.message as any)?.usage) {
							const u = (e.message as any).usage;
							add(totals, {
								input: u.input ?? 0,
								output: u.output ?? 0,
								cacheRead: u.cacheRead ?? 0,
								cacheWrite: u.cacheWrite ?? 0,
								cost: u.cost?.total ?? 0,
							});
							if (e.message.role === "assistant") {
								const prompt = u.input + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
								if (prompt > 0) hitRate = ((u.cacheRead ?? 0) / prompt) * 100;
							}
						} else if (e.type === "usage" && e.usage) {
							add(totals, {
								input: e.usage.input ?? 0,
								output: e.usage.output ?? 0,
								cacheRead: e.usage.cacheRead ?? 0,
								cacheWrite: e.usage.cacheWrite ?? 0,
								cost: e.usage.cost?.total ?? 0,
							});
						}
					}

					const stats: string[] = [];
					if (totals.input) stats.push(`↑${formatTokens(totals.input)}`);
					if (totals.output) stats.push(`↓${formatTokens(totals.output)}`);
					if (totals.cacheRead) stats.push(`R${formatTokens(totals.cacheRead)}`);
					if (totals.cacheWrite) stats.push(`W${formatTokens(totals.cacheWrite)}`);
					if ((totals.cacheRead > 0 || totals.cacheWrite > 0) && hitRate !== undefined) {
						stats.push(`CH${hitRate.toFixed(1)}%`);
					}
					if (totals.cost) stats.push(`$${totals.cost.toFixed(3)}`);

					const usage = ctx.getContextUsage?.();
					const window = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
					const percent = usage?.percent ?? null;
					const ctxText = percent === null || percent === undefined
						? `?/${formatTokens(window)}`
						: `${percent.toFixed(1)}%/${formatTokens(window)}`;
					stats.push(ctxText);

					// Right side mirrors built-in footer: (provider) model • thinking level
					const model = ctx.model;
					let rightSide = model?.id || "no-model";
					if (model?.reasoning) {
						const level = ctx.thinkingLevel || "off";
						rightSide = level === "off" ? `${rightSide} • thinking off` : `${rightSide} • ${level}`;
					}
					if (model && (footerData.getAvailableProviderCount?.() ?? 0) > 1) {
						const withProvider = `(${model.provider}) ${rightSide}`;
						if (visibleWidth(stats.join(" ")) + MIN_PAD + visibleWidth(withProvider) <= width) {
							rightSide = withProvider;
						}
					}

								const speedText = !enabled ? "" : rate !== null ? `${LABEL} : ${rate.toFixed(1)}` : `${LABEL} : ~`;

					const left = theme.fg("dim", stats.join(" "));
					const right = theme.fg("dim", rightSide);
					const leftW = visibleWidth(left);
					const rightW = visibleWidth(right);
					const statsLine = truncateToWidth(
						left + " ".repeat(Math.max(1, width - leftW - rightW)) + right,
						width,
						"...",
					);

					const branch = footerData.getGitBranch();
					const cwd = ctx.sessionManager.getCwd().replace(process.env.HOME ?? "~", "~");
					const lines = [
						renderPwdLine(theme, cwd, branch, speedText, width),
						theme.fg("dim", statsLine),
					];

					const statuses = footerData.getExtensionStatuses();
					if (statuses.size > 0) {
						const text = Array.from(statuses.entries())
							.sort(([a], [b]) => a.localeCompare(b))
							.map(([, v]) => v.replace(/[\r\n\t]/g, " ").trim())
							.join(" ");
						lines.push(truncateToWidth(text, width, "..."));
					}
					return lines.map((l) => truncateToWidth(l, width, "..."));
				},
			};
		});
		ctx.ui.requestRender?.();
	};

	pi.on("session_start", (_event: any, ctx: any) => {
		startedAt = null;
		rate = null;
		install(ctx);
	});
	pi.on("message_start", (event: any) => {
		if (event?.message?.role !== "assistant") return;
		startedAt = Date.now();
	});
	pi.on("message_end", (event: any) => {
		const message = event?.message;
		if (message?.role === "assistant" && startedAt !== null) {
			const started = startedAt;
			startedAt = null;
			const shared = sharedRate();
			if (shared && shared.at >= started) {
				rate = shared.rate;
			} else {
				const elapsed = Date.now() - started;
				const tokens = message.usage?.output ?? 0;
				if (elapsed >= MIN_MS && tokens > 0) rate = tokens / (elapsed / 1000);
			}
		}
		ui?.requestRender?.();
	});
	pi.on("turn_end", () => ui?.requestRender?.());

	pi.registerCommand("tokenspeed", {
		description: "Toggle TOK/s readout in footer",
		handler: async () => {
			enabled = !enabled;
			ui?.notify(`token speed ${enabled ? "on" : "off"}`, "info");
			ui?.requestRender?.();
		},
	});
}
