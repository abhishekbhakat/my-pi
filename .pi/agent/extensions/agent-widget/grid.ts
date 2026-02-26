import type { AgentInstance } from "./types";
import { renderCard } from "./card";

const COLUMN_ORDER = ["scout", "coder", "reviewer", "youtrack"];
const MIN_COLUMN_WIDTH = 30;
const GAP = 1;

interface GridColumn {
	typeName: string;
	agents: AgentInstance[];
}

function getGrid(instances: Map<string, AgentInstance>): GridColumn[] {
	const groups = new Map<string, AgentInstance[]>();

	for (const inst of instances.values()) {
		const typeName = inst.def.name.toLowerCase();
		const column = groups.get(typeName) || [];
		column.push(inst);
		column.sort((a, b) => a.id - b.id);
		groups.set(typeName, column);
	}

	const result: GridColumn[] = [];
	for (const typeName of COLUMN_ORDER) {
		const agents = groups.get(typeName);
		if (agents && agents.length > 0) {
			result.push({ typeName, agents });
		}
	}

	for (const [typeName, agents] of groups) {
		if (!COLUMN_ORDER.includes(typeName)) {
			result.push({ typeName, agents });
		}
	}

	return result;
}

function renderVerticalStack(
	instances: Map<string, AgentInstance>,
	width: number,
	theme: any
): string[] {
	const lines: string[] = [];
	const sorted = Array.from(instances.values()).sort((a, b) => {
		const typeOrder = COLUMN_ORDER.indexOf(a.def.name.toLowerCase()) - COLUMN_ORDER.indexOf(b.def.name.toLowerCase());
		if (typeOrder !== 0) return typeOrder;
		return a.id - b.id;
	});

	for (const inst of sorted) {
		lines.push(...renderCard(inst, width, theme));
		lines.push("");
	}

	return lines.length > 0 ? lines.slice(0, -1) : lines;
}

export function renderGrid(
	instances: Map<string, AgentInstance>,
	width: number,
	theme: any
): string[] {
	if (instances.size === 0) return [];

	const grid = getGrid(instances);
	const numCols = grid.length;

	if (numCols === 0) return [];

	const colWidth = Math.floor((width - GAP * (numCols - 1)) / numCols);

	if (colWidth < MIN_COLUMN_WIDTH) {
		return renderVerticalStack(instances, width, theme);
	}

	const columns: string[][] = [];
	const maxHeights: number[] = [];

	for (const { typeName, agents } of grid) {
		const colLines: string[] = [];

		const headerText = typeName.toUpperCase();
		const headerPadded = padRight(" " + headerText, colWidth);
		colLines.push(theme.fg("dim", headerPadded));

		for (const inst of agents) {
			colLines.push(...renderCard(inst, colWidth, theme));
			colLines.push("");
		}

		if (colLines.length > 0 && colLines[colLines.length - 1] === "") {
			colLines.pop();
		}

		columns.push(colLines);
		maxHeights.push(colLines.length);
	}

	const maxHeight = Math.max(...maxHeights);

	for (const col of columns) {
		while (col.length < maxHeight) {
			col.push(" ".repeat(colWidth));
		}
	}

	const RESET = "\x1b[0m";
	const gap = " ".repeat(GAP);
	const lines: string[] = [];

	for (let row = 0; row < maxHeight; row++) {
		const rowContent = columns.map(col => col[row]).join(RESET + gap);
		lines.push(rowContent + RESET);
	}

	return lines;
}

function padRight(s: string, target: number): string {
	const visibleLen = s.replace(/\x1b\[[0-9;]*m/g, "").length;
	const pad = Math.max(0, target - visibleLen);
	return s + " ".repeat(pad);
}
