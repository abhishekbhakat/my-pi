import { JOB_NOTICE_RENDER_JS } from "../web/job-notices";
import { INCREMENTAL_RENDERER_JS } from "../web/incremental";
import { WINDOWED_TREE_JS, VISIBLE_ANCESTOR_JS } from "../web/tree";

/** Fail explicitly when upstream changes the private renderer contract. */
export function patchTemplateJs(source: string): string {
	const replacements = [
		["        if (entry.type === 'custom_message') {", JOB_NOTICE_RENDER_JS + "\n        if (entry.type === 'custom_message') {"],
		["const globalStats = computeStats(entries);", "let globalStats = computeStats(entries);"],
		["      // Initial render\n", `${INCREMENTAL_RENDERER_JS}\n      // Initial render\n`],
	];
	const required = [
		"const { header, entries, leafId: defaultLeafId, systemPrompt, tools, renderedTools } = data;",
		"const byId = new Map();", "const entryCache = new Map();", "let treeNodeMap = null;",
		"let currentLeafId = leafId;", "let currentTargetId = urlTargetId || leafId;",
		"function getPath(targetId)", "function forceTreeRerender()", "function renderEntryToNode(entry)",
		"function navigateTo(targetId, scrollMode = 'target', scrollToEntryId = null)",
		"const attachHeaderHandlers = () =>", "function renderHeader()", "function computeStats(",
		"const toolCallMap = new Map();", "const labelMap = new Map();",
		...replacements.map(([anchor]) => anchor),
	];
	for (const anchor of required) {
		if (source.split(anchor).length !== 2) {
			throw new Error(`Pi export renderer incompatible with live updates (${anchor}). Update Web UI adapter.`);
		}
	}
	for (const [anchor, replacement] of replacements) source = source.replace(anchor, () => replacement);
	const sections = [
		["      function renderTree() {", "      function forceTreeRerender()", WINDOWED_TREE_JS + "\n"],
		["        function findVisibleAncestor(nodeId) {", "        // Build visible tree structure", VISIBLE_ANCESTOR_JS + "\n"],
	];
	for (const [start, end, replacement] of sections) {
		if (source.split(start).length !== 2 || source.split(end).length !== 2) {
			throw new Error(`Pi export renderer incompatible with windowed tree (${start}). Update Web UI adapter.`);
		}
		const from = source.indexOf(start);
		const to = source.indexOf(end, from);
		if (to < from) throw new Error(`Pi export renderer tree anchors out of order (${start}).`);
		source = source.slice(0, from) + replacement + source.slice(to);
	}
	return source;
}
