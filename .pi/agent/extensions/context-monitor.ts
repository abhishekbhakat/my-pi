/**
 * Context Monitor Extension - Shows context window utilization in the footer
 *
 * Displays: current context / max context (percentage)
 * Example: "45.2k/128k (35%)"
 * Auto-enables on session start
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { CustomEntry } from "@mariozechner/pi-coding-agent/dist/core/session-manager.js";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

function formatTokens(n: number): string {
	if (n < 1000) return `${n}`;
	if (n < 1000000) return `${(n / 1000).toFixed(1)}k`;
	return `${(n / 1000000).toFixed(2)}M`;
}

interface ContextMonitorState {
	maxContextTokens: number;
	lastContextWindow: number;
}

const CUSTOM_TYPE = "context-monitor";
const SAVE_DEBOUNCE_MS = 5000; // Only save every 5 seconds max

export default function (pi: ExtensionAPI) {
	let enabled = false;
	// Track max context seen so far (only grows, never shrinks)
	let maxContextTokens = 0;
	let lastContextWindow = 0;
	let saveTimeout: ReturnType<typeof setTimeout> | null = null;
	let lastSavedState: string = "";

	function loadState(ctx: ExtensionContext) {
		const entries = ctx.sessionManager.getEntries();
		// Find the latest context-monitor entry
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i];
			if (entry.type === "custom" && (entry as CustomEntry).customType === CUSTOM_TYPE) {
				const data = (entry as CustomEntry<ContextMonitorState>).data;
				if (data && typeof data.maxContextTokens === "number") {
					maxContextTokens = data.maxContextTokens;
					lastContextWindow = data.lastContextWindow || 0;
					lastSavedState = JSON.stringify(data);
				}
				return;
			}
		}
	}

	function saveState(ctx: ExtensionContext) {
		// Clear any pending save
		if (saveTimeout) {
			clearTimeout(saveTimeout);
		}

		// Debounce the save
		saveTimeout = setTimeout(() => {
			const state: ContextMonitorState = { maxContextTokens, lastContextWindow };
			const stateStr = JSON.stringify(state);
			// Only save if state actually changed
			if (stateStr !== lastSavedState) {
				pi.appendEntry(CUSTOM_TYPE, state);
				lastSavedState = stateStr;
			}
			saveTimeout = null;
		}, SAVE_DEBOUNCE_MS);
	}

	function enableFooter(ctx: Parameters<Parameters<typeof pi.registerCommand>[1]["handler"]>[1]) {
		ctx.ui.setFooter((tui, theme, footerData) => {
			const unsubBranch = footerData.onBranchChange(() => tui.requestRender());

			return {
				dispose: unsubBranch,
				invalidate() {},
				render(width: number): string[] {
					// Get context usage from pi (includes tokens, contextWindow, percent)
					const usage = ctx.getContextUsage();
					const modelId = ctx.model?.id || "";

					let contextStr: string;
					let percentage = 0;

					if (usage && usage.tokens !== null) {
						// Update max if current is larger, or if context window changed (new model)
						const shouldUpdate = usage.tokens > maxContextTokens || usage.contextWindow !== lastContextWindow;
						if (shouldUpdate) {
							maxContextTokens = usage.tokens;
							lastContextWindow = usage.contextWindow;
							// Persist the new max
							saveState(ctx);
						}

						percentage = (maxContextTokens / usage.contextWindow) * 100;
						contextStr = `${formatTokens(maxContextTokens)}/${formatTokens(usage.contextWindow)} (${percentage.toFixed(2)}%)`;
					} else if (usage) {
						// We know the context window but not current tokens (e.g., after compaction)
						// Keep showing the max we saw before
						if (maxContextTokens > 0) {
							percentage = (maxContextTokens / usage.contextWindow) * 100;
							contextStr = `${formatTokens(maxContextTokens)}/${formatTokens(usage.contextWindow)} (${percentage.toFixed(2)}%)`;
						} else {
							contextStr = `?/${formatTokens(usage.contextWindow)}`;
						}
					} else {
						contextStr = "no data";
					}

					// Gradient color based on percentage (green -> yellow -> red)
					let color: "success" | "warning" | "error" | "dim" = "dim";
					if (percentage >= 80) color = "error";
					else if (percentage >= 50) color = "warning";
					else if (percentage > 0) color = "success";

					// Left side: context utilization with gradient color
					const left = theme.fg(color, `ctx: ${contextStr}`);

					// Right side: model and git branch
					const gitBranch = footerData.getGitBranch();
					const branchStr = gitBranch ? ` (${gitBranch})` : "";
					const right = theme.fg("dim", `${modelId || "no-model"}${branchStr}`);

					const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));
					return [truncateToWidth(left + pad + right, width)];
				},
			};
		});
	}

	// Auto-enable on session start
	pi.on("session_start", (_event, ctx) => {
		enabled = true;
		// Load persisted state for this session
		loadState(ctx);
		enableFooter(ctx);
	});

	// Reset max context tracking on session switch
	pi.on("session_switch", (event, _ctx) => {
		if (event.reason === "new") {
			maxContextTokens = 0;
			lastContextWindow = 0;
			lastSavedState = "";
		}
	});

	pi.registerCommand("context-monitor", {
		description: "Toggle context window monitor in footer",
		handler: async (_args, ctx) => {
			enabled = !enabled;

			if (enabled) {
				enableFooter(ctx);
				ctx.ui.notify("Context monitor enabled", "info");
			} else {
				ctx.ui.setFooter(undefined);
				ctx.ui.notify("Default footer restored", "info");
			}
		},
	});
}
