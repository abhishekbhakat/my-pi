/**
 * Auto-compact when context usage hits a percent of the model window.
 *
 * Built-in auto-compact only fires near the limit (contextWindow - reserve).
 * This extension fires earlier (default 75%), with optional fixed-model
 * summaries and auto-resume when a compact interrupts mid-task tool work.
 *
 * Manual: /autocompact
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCommand } from "./command";
import { registerHooks } from "./hooks";
import { createRuntime } from "./runtime";

export default function autoCompactExtension(pi: ExtensionAPI) {
	const rt = createRuntime(pi);
	registerHooks(pi, rt);
	registerCommand(pi, rt);
}

export { DEFAULT_CONFIG, DEFAULT_THRESHOLD, configPath } from "./config";
