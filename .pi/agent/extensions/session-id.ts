import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ExtensionAPI, ExtensionContext, ReadonlyFooterDataProvider, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type Component, type TUI } from "@earendil-works/pi-tui";

// Render logic pinned to pi 0.84.3 dist/modes/interactive/components/footer.js.
// Re-check against footer.js when pi upgrades; /footer restores the built-in footer.

type UsageLike = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: { total: number };
};

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

function formatCwdForFooter(cwd: string, home: string | undefined): string {
	if (!home) return cwd;
	const resolvedCwd = resolve(cwd);
	const resolvedHome = resolve(home);
	const relativeToHome = relative(resolvedHome, resolvedCwd);
	const isInsideHome =
		relativeToHome === "" ||
		(relativeToHome !== ".." && !relativeToHome.startsWith(`..${sep}`) && !isAbsolute(relativeToHome));
	if (!isInsideHome) return cwd;
	return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
}

function sanitizeStatusText(text: string): string {
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

export default function (pi: ExtensionAPI) {
	let enabled = true;

	const install = (ctx: ExtensionContext) => {
		if (!enabled) {
			ctx.ui.setFooter(undefined);
			return;
		}
		ctx.ui.setFooter((tui: TUI, theme: Theme, footerData: ReadonlyFooterDataProvider) => {
			const unsub = footerData.onBranchChange(() => tui.requestRender());
			const component: Component & { dispose?(): void } = {
				invalidate() {},
				dispose() {
					unsub();
				},
				render(width: number): string[] {
					// Token/cost totals across the whole session
					let input = 0,
						output = 0,
						cacheRead = 0,
						cacheWrite = 0,
						cost = 0;
					let latestCacheHitRate: number | undefined;
					for (const entry of ctx.sessionManager.getEntries()) {
						const msg = entry.type === "message" ? entry.message : undefined;
						let usage: UsageLike | undefined;
						if (msg?.role === "assistant") usage = msg.usage as UsageLike;
						else if (msg?.role === "toolResult") usage = msg.usage as UsageLike | undefined;
						else if ((entry.type === "branch_summary" || entry.type === "compaction") && entry.usage)
							usage = entry.usage as UsageLike;
						if (!usage) continue;
						input += usage.input;
						output += usage.output;
						cacheRead += usage.cacheRead;
						cacheWrite += usage.cacheWrite;
						cost += usage.cost.total;
						if (msg?.role === "assistant") {
							const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
							if (promptTokens > 0) latestCacheHitRate = (usage.cacheRead / promptTokens) * 100;
						}
					}

					// Context usage, percent colored like the built-in footer
					const cu = ctx.getContextUsage();
					const contextWindow = cu?.contextWindow ?? ctx.model?.contextWindow ?? 0;
					const contextPercentValue = cu?.percent ?? 0;
					const contextPercent = cu?.percent !== null ? contextPercentValue.toFixed(1) : "?";
					const contextPercentDisplay = `${contextPercent}%/${formatTokens(contextWindow)} (auto)`;
					const contextPercentStr =
						contextPercentValue > 90
							? theme.fg("error", contextPercentDisplay)
							: contextPercentValue > 70
								? theme.fg("warning", contextPercentDisplay)
								: contextPercentDisplay;

					// Line 1: pwd + git branch + session name
					let pwd = formatCwdForFooter(
						ctx.sessionManager.getCwd(),
						process.env.HOME || process.env.USERPROFILE,
					);
					const branch = footerData.getGitBranch();
					if (branch) pwd = `${pwd} (${branch})`;
					const sessionName = ctx.sessionManager.getSessionName();
					if (sessionName) pwd = `${pwd} • ${sessionName}`;

					// Line 2: stats left + model right
					const statsParts: string[] = [];
					if (input) statsParts.push(`↑${formatTokens(input)}`);
					if (output) statsParts.push(`↓${formatTokens(output)}`);
					if (cacheRead) statsParts.push(`R${formatTokens(cacheRead)}`);
					if (cacheWrite) statsParts.push(`W${formatTokens(cacheWrite)}`);
					if ((cacheRead > 0 || cacheWrite > 0) && latestCacheHitRate !== undefined)
						statsParts.push(`CH${latestCacheHitRate.toFixed(1)}%`);
					// Subscription marker approximated: only kimi-coding; the runtime
					// isUsingSubscription() check is not exposed to extensions.
					const isSub = ctx.model?.provider === "kimi-coding";
					if (cost || isSub) statsParts.push(`$${cost.toFixed(3)}${isSub ? " (sub)" : ""}`);
					statsParts.push(contextPercentStr);
					if (process.env.PI_EXPERIMENTAL === "1")
						statsParts.push(`${theme.fg("dim", "•")} ${theme.bold(theme.fg("warning", "xp"))}`);

					let statsLeft = statsParts.join(" ");
					if (visibleWidth(statsLeft) > width) statsLeft = truncateToWidth(statsLeft, width, "...");

					const modelName = ctx.model?.id || "no-model";
					let rightSide = modelName;
					if (ctx.model?.reasoning) {
						const thinkingLevel = ctx.thinkingLevel || "off";
						rightSide = thinkingLevel === "off" ? `${modelName} • thinking off` : `${modelName} • ${thinkingLevel}`;
					}
					if (footerData.getAvailableProviderCount() > 1 && ctx.model) {
						const withProvider = `(${ctx.model.provider}) ${rightSide}`;
						if (visibleWidth(statsLeft) + 2 + visibleWidth(withProvider) <= width) rightSide = withProvider;
					}

					const leftWidth = visibleWidth(statsLeft);
					const rightWidth = visibleWidth(rightSide);
					let statsLine: string;
					if (leftWidth + 2 + rightWidth <= width) {
						statsLine = statsLeft + " ".repeat(width - leftWidth - rightWidth) + rightSide;
					} else {
						const availableForRight = width - leftWidth - 2;
						if (availableForRight > 0) {
							const truncatedRight = truncateToWidth(rightSide, availableForRight, "");
							const truncatedRightWidth = visibleWidth(truncatedRight);
							statsLine =
								statsLeft + " ".repeat(Math.max(0, width - leftWidth - truncatedRightWidth)) + truncatedRight;
						} else {
							statsLine = statsLeft;
						}
					}

					const lines = [
						truncateToWidth(theme.fg("dim", pwd), width, theme.fg("dim", "...")),
						theme.fg("dim", statsLeft) + theme.fg("dim", statsLine.slice(statsLeft.length)),
					];

					// Line 3: extension statuses left + session id right-aligned under model
					const statuses = Array.from(footerData.getExtensionStatuses().entries())
						.sort(([a], [b]) => a.localeCompare(b))
						.map(([, text]) => sanitizeStatusText(text));
					const sessionId = ctx.sessionManager.getSessionId() ?? "";
					const left = statuses.join(" ");
					const idWidth = visibleWidth(sessionId);
					if (sessionId && visibleWidth(left) + 2 + idWidth <= width) {
						const pad = " ".repeat(width - visibleWidth(left) - idWidth);
						lines.push(theme.fg("dim", left + pad + sessionId));
					} else if (sessionId) {
						const idLine = left
							? truncateToWidth(left + "  " + sessionId, width, "...")
							: truncateToWidth(sessionId, width, "...");
						lines.push(theme.fg("dim", idLine));
					} else if (left) {
						lines.push(truncateToWidth(left, width, theme.fg("dim", "...")));
					}
					return lines;
				},
			};
			return component;
		});
	};

	pi.registerCommand("footer", {
		description: "Toggle custom session-id footer (built-in footer when off)",
		handler: async (_args, ctx) => {
			enabled = !enabled;
			install(ctx);
			ctx.ui.notify(enabled ? "Session-id footer on" : "Built-in footer", "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		install(ctx);
	});
}
