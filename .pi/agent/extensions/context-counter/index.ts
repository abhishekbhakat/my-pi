import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

const ENTRY_TYPE = "context-counter";

function formatTokens(tokens: number): string {
	if (tokens >= 1_000_000) {
		const value = tokens / 1_000_000;
		return `${value % 1 === 0 ? value.toFixed(0) : value.toFixed(1)}m`;
	}
	if (tokens >= 1_000) {
		const value = tokens / 1_000;
		return `${value % 1 === 0 ? value.toFixed(0) : value.toFixed(1)}k`;
	}
	return `${tokens}`;
}

function getColorName(percent: number): "success" | "warning" | "error" {
	if (percent < 60) return "success";
	if (percent <= 80) return "warning";
	return "error";
}

function shortenPath(path: string): string {
	const home = process.env.HOME;
	if (home && path === home) return "~";
	if (home && path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`;
	return path;
}

export default function contextCounterExtension(pi: ExtensionAPI): void {
	let highWaterMark = 0;
	let lastReportedTokens: number | null = null;
	let lastContextWindow: number | null = null;
	let requestFooterRender: (() => void) | undefined;

	function reconstructState(ctx: ExtensionContext): void {
		highWaterMark = 0;

		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== ENTRY_TYPE) continue;
			const value = entry.data as { highWaterMark?: unknown } | undefined;
			if (typeof value?.highWaterMark === "number" && Number.isFinite(value.highWaterMark)) {
				highWaterMark = Math.max(0, Math.floor(value.highWaterMark));
			}
		}
	}

	function getDisplayedTokens(): number {
		return Math.max(highWaterMark, lastReportedTokens ?? 0);
	}

	function getContextWindow(ctx: ExtensionContext): number | null {
		const modelWindow = typeof ctx.model?.contextWindow === "number" ? ctx.model.contextWindow : null;
		return lastContextWindow ?? modelWindow;
	}

	function getCounterText(ctx: ExtensionContext): string {
		const tokens = getDisplayedTokens();
		const contextWindow = getContextWindow(ctx);
		if (!contextWindow || contextWindow <= 0) return `${formatTokens(tokens)}/--`;
		const percent = (tokens / contextWindow) * 100;
		return `${formatTokens(tokens)}/${formatTokens(contextWindow)} (${percent.toFixed(1)}%)`;
	}

	function getCounterDisplay(ctx: ExtensionContext): string {
		const contextWindow = getContextWindow(ctx);
		if (!contextWindow || contextWindow <= 0) {
			return ctx.ui.theme.fg("warning", getCounterText(ctx));
		}
		const percent = (getDisplayedTokens() / contextWindow) * 100;
		return ctx.ui.theme.fg(getColorName(percent), getCounterText(ctx));
	}

	function getModelInfo(ctx: ExtensionContext): string {
		if (!ctx.model) return "no-model";
		const model = ctx.model as { provider?: string; id: string };
		const provider = model.provider ? `(${model.provider}) ` : "";
		return `${provider}${model.id} - ${pi.getThinkingLevel()}`;
	}

	function invalidateFooter(): void {
		requestFooterRender?.();
	}

	function syncUsage(ctx: ExtensionContext, persistHighWaterMark: boolean): void {
		const usage = ctx.getContextUsage();

		if (usage) {
			lastContextWindow = usage.contextWindow;
			lastReportedTokens = typeof usage.tokens === "number" && Number.isFinite(usage.tokens)
				? Math.max(0, Math.floor(usage.tokens))
				: null;
		} else {
			lastReportedTokens = null;
		}

		const candidate = lastReportedTokens ?? 0;
		if (candidate > highWaterMark) {
			highWaterMark = candidate;
			if (persistHighWaterMark) {
				pi.appendEntry(ENTRY_TYPE, { highWaterMark });
			}
		}

		invalidateFooter();
	}

	function rebuildAndRefresh(ctx: ExtensionContext): void {
		reconstructState(ctx);
		syncUsage(ctx, false);
	}

	pi.on("session_start", async (_event, ctx) => {
		rebuildAndRefresh(ctx);
		ctx.ui.setFooter((tui, theme, footerData) => {
			requestFooterRender = () => tui.requestRender();
			const dispose = footerData.onBranchChange(() => tui.requestRender());

			return {
				dispose() {
					requestFooterRender = undefined;
					dispose();
				},
				invalidate() {
					tui.requestRender();
				},
				render(width: number): string[] {
					const gitBranch = footerData.getGitBranch();
					const leftTop = shortenPath(ctx.cwd) + (gitBranch ? ` (${gitBranch})` : "");
					const leftBottom = getCounterDisplay(ctx);
					const rightBottom = theme.fg("dim", getModelInfo(ctx));
					const padding = " ".repeat(Math.max(1, width - visibleWidth(leftBottom) - visibleWidth(rightBottom)));

					return [
						truncateToWidth(leftTop, width),
						truncateToWidth(leftBottom + padding + rightBottom, width),
					];
				},
			};
		});
	});

	pi.on("session_tree", async (_event, ctx) => {
		rebuildAndRefresh(ctx);
	});

	pi.on("message_end", async (_event, ctx) => {
		syncUsage(ctx, true);
	});

	pi.registerCommand("token-count-clear", {
		description: "Reset the saved context high water mark for the current session",
		handler: async (_args, ctx) => {
			await ctx.waitForIdle();
			highWaterMark = 0;
			pi.appendEntry(ENTRY_TYPE, { highWaterMark: 0 });
			syncUsage(ctx, false);
			ctx.ui.notify("Context counter high water mark cleared", "info");
		},
	});
}
