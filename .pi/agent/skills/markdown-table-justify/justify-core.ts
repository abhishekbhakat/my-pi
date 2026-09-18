import { columnMayPeel } from "./justify-jev.ts";

export const DEFAULT_WIDTH = 128;

const TABLE_LINE = /^\s*\|.*\|\s*$/;
const SEP_CELL = /^:?-+:?$/;

export function isTableLine(line: string): boolean {
	return TABLE_LINE.test(line);
}

export function isSeparatorRow(cells: string[]): boolean {
	const nonempty = cells.filter((c) => c.trim());
	if (nonempty.length === 0) return false;
	return nonempty.every((c) => SEP_CELL.test(c.replaceAll(" ", "")));
}

export function splitRow(line: string): string[] {
	let raw = line.trim();
	if (raw.startsWith("|")) raw = raw.slice(1);
	if (raw.endsWith("|")) raw = raw.slice(0, -1);

	const cells: string[] = [];
	let buf = "";
	let i = 0;
	while (i < raw.length) {
		const ch = raw[i];
		if (ch === "\\" && i + 1 < raw.length && raw[i + 1] === "|") {
			buf += "|";
			i += 2;
			continue;
		}
		if (ch === "|") {
			cells.push(buf.trim());
			buf = "";
			i += 1;
			continue;
		}
		buf += ch;
		i += 1;
	}
	cells.push(buf.trim());
	return cells;
}

export function trimEmptyColumns(rows: string[][]): string[][] {
	if (rows.length === 0) return rows;
	const colCount = Math.max(...rows.map((r) => r.length));
	for (const r of rows) {
		while (r.length < colCount) r.push("");
	}
	const sepIdx = rows.findIndex((r) => isSeparatorRow(r));

	const colHasContent = (c: number): boolean => {
		for (let i = 0; i < rows.length; i++) {
			if (sepIdx >= 0 && i === sepIdx) continue;
			if (rows[i][c].trim()) return true;
		}
		return false;
	};

	let last = colCount - 1;
	while (last > 0 && !colHasContent(last)) last -= 1;
	const width = last + 1;
	return rows.map((r) => r.slice(0, width));
}

export function parseAlign(cell: string): string {
	const s = cell.replaceAll(" ", "");
	const left = s.startsWith(":");
	const right = s.endsWith(":");
	if (left && right) return "center";
	if (right) return "right";
	return "left";
}

export function padCell(text: string, width: number, align: string): string {
	text = text.trim();
	if (text.length >= width) return text;
	const pad = width - text.length;
	if (align === "right") return " ".repeat(pad) + text;
	if (align === "center") {
		const left = Math.floor(pad / 2);
		return " ".repeat(left) + text + " ".repeat(pad - left);
	}
	return text + " ".repeat(pad);
}

export function formatSeparator(width: number, align: string): string {
	const inner = Math.max(width, 3);
	const body = "-".repeat(inner);
	if (align === "center") return `:${body.slice(1, -1)}:`;
	if (align === "right") return `${body.slice(0, -1)}:`;
	return body;
}

export function rowWidth(colWidths: number[]): number {
	const n = colWidths.length;
	return colWidths.reduce((a, b) => a + b, 0) + 3 * n + 1;
}

function percentileNearestRank(sortedVals: number[], pct: number): number {
	if (sortedVals.length === 0) throw new Error("empty sample");
	const n = sortedVals.length;
	const rank = Math.max(1, Math.min(n, Math.floor((pct * n + 99) / 100)));
	return sortedVals[rank - 1];
}

function medianOf(sortedVals: number[]): number {
	if (sortedVals.length === 0) return 0;
	const n = sortedVals.length;
	const mid = Math.floor(n / 2);
	if (n % 2) return sortedVals[mid];
	return sortedVals[mid - 1];
}

export function colMaxes(
	headerLens: number[],
	bodyLens: number[][],
	colCount: number,
): number[] {
	const out: number[] = [];
	for (let c = 0; c < colCount; c++) {
		let mx = headerLens[c];
		if (bodyLens[c].length > 0) mx = Math.max(mx, Math.max(...bodyLens[c]));
		out.push(Math.max(3, mx));
	}
	return out;
}

export function typicalWidths(
	headerLens: number[],
	bodyLens: number[][],
	colCount: number,
): [number[], number[], number[]] {
	const bases: number[] = [];
	const softs: number[] = [];
	const hards: number[] = [];
	for (let c = 0; c < colCount; c++) {
		const samples = [...bodyLens[c]];
		const h = headerLens[c];
		const hard = Math.max(3, h);
		if (samples.length === 0) {
			bases.push(hard);
			softs.push(hard);
			hards.push(hard);
			continue;
		}
		const samplesSorted = [...samples].sort((a, b) => a - b);
		const mx = Math.max(samplesSorted[samplesSorted.length - 1], h);
		if (samplesSorted.length <= 2) {
			const base = Math.max(3, mx);
			const soft = Math.max(hard, medianOf(samplesSorted));
			bases.push(base);
			softs.push(Math.min(soft, base));
			hards.push(hard);
			continue;
		}
		const p75 = percentileNearestRank(samplesSorted, 75);
		const med = medianOf(samplesSorted);
		const soft = Math.max(hard, med);
		let base = Math.max(hard, p75, soft);
		base = mx >= soft ? Math.min(base, mx) : base;
		base = Math.max(base, soft);
		bases.push(base);
		softs.push(soft);
		hards.push(hard);
	}
	return [bases, softs, hards];
}

export function scaleToward(widths: number[], floors: number[], target: number): number[] {
	const out = [...widths];
	const n = out.length;
	if (n === 0 || rowWidth(out) <= target) return out;
	let deficit = rowWidth(out) - target;
	while (deficit > 0) {
		const slacks: [number, number][] = [];
		for (let i = 0; i < n; i++) {
			if (out[i] > floors[i]) slacks.push([out[i] - floors[i], i]);
		}
		if (slacks.length === 0) break;
		slacks.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
		const idx = slacks[0][1];
		out[idx] -= 1;
		deficit -= 1;
	}
	return out;
}

export function chooseWidths(
	maxes: number[],
	_bases: number[],
	softFloors: number[],
	hardFloors: number[],
	target: number,
	peelMask?: boolean[] | null,
): number[] {
	if (rowWidth(maxes) <= target) return [...maxes];
	const n = maxes.length;
	if (peelMask && peelMask.length === n) {
		if (!peelMask.some(Boolean)) return [...maxes];
		const floors = maxes.map((m, i) => (peelMask[i] ? hardFloors[i] : m));
		return scaleToward(maxes, floors, target);
	}
	let scaled = scaleToward(maxes, softFloors, target);
	scaled = scaleToward(scaled, hardFloors, target);
	return scaled;
}

function escCell(text: string): string {
	return text.replaceAll("|", "\\|");
}

export function formatBodyRow(
	raw: string[],
	widths: number[],
	aligns: string[],
	target: number,
): string[] {
	const n = widths.length;
	const lens = raw.map((t) => t.length);
	const natural = lens.reduce((a, b) => a + b, 0) + 3 * n + 1;
	const grid = rowWidth(widths);

	if (natural > target) {
		const cells: string[] = [];
		let seenOverflow = false;
		for (let c = 0; c < n; c++) {
			const text = raw[c];
			if (text.length > widths[c]) {
				seenOverflow = true;
				cells.push(escCell(text));
			} else if (seenOverflow) {
				cells.push(escCell(text));
			} else {
				cells.push(escCell(padCell(text, widths[c], aligns[c])));
			}
		}
		return cells;
	}

	const desired = lens.every((length, c) => length <= widths[c]) ? grid : target;
	let budget = Math.max(0, desired - natural);
	const cells: string[] = [];
	for (let c = 0; c < n; c++) {
		const text = raw[c];
		const length = lens[c];
		if (length > widths[c]) {
			cells.push(escCell(text));
			continue;
		}
		const want = widths[c] - length;
		const take = Math.min(want, budget);
		budget -= take;
		cells.push(escCell(padCell(text, length + take, aligns[c])));
	}
	return cells;
}

export async function justifyTable(
	lines: string[],
	target: number,
	useJev = true,
): Promise<string[]> {
	const rows = trimEmptyColumns(lines.map((line) => splitRow(line)));
	if (rows.length < 2) return lines;

	const colCount = Math.max(...rows.map((r) => r.length));
	if (colCount === 0) return lines;
	for (const r of rows) {
		while (r.length < colCount) r.push("");
	}

	const sepIdx = rows.findIndex((r) => isSeparatorRow(r));
	let aligns = Array.from({ length: colCount }, () => "left");
	if (sepIdx >= 0) {
		aligns = rows[sepIdx].map((c) => parseAlign(c));
		while (aligns.length < colCount) aligns.push("left");
	}

	const headerIdx = rows.findIndex((_, i) => sepIdx < 0 || i !== sepIdx);
	const headerAt = headerIdx >= 0 ? headerIdx : 0;
	const headerLens = Array.from({ length: colCount }, (_, c) => rows[headerAt][c].trim().length);
	const bodyLens: number[][] = Array.from({ length: colCount }, () => []);
	for (let i = 0; i < rows.length; i++) {
		if (i === headerAt) continue;
		if (sepIdx >= 0 && i === sepIdx) continue;
		for (let c = 0; c < colCount; c++) bodyLens[c].push(rows[i][c].trim().length);
	}

	const maxes = colMaxes(headerLens, bodyLens, colCount);
	const [bases, softs, hards] = typicalWidths(headerLens, bodyLens, colCount);
	let peelMask: boolean[] | null = null;
	if (useJev && rowWidth(maxes) > target) {
		const headers = Array.from({ length: colCount }, (_, c) => rows[headerAt][c].trim());
		const samples: string[][] = Array.from({ length: colCount }, () => []);
		for (let i = 0; i < rows.length; i++) {
			if (sepIdx >= 0 && i === sepIdx) continue;
			for (let c = 0; c < colCount; c++) {
				const cell = rows[i][c].trim();
				if (cell && !samples[c].includes(cell)) samples[c].push(cell);
			}
		}
		peelMask = await columnMayPeel(headers, samples, maxes, target);
		if (peelMask === null) {
			console.error("justify: Jev peel skipped; numeric peel.");
		}
	}
	const widths = chooseWidths(maxes, bases, softs, hards, target, peelMask);

	const out: string[] = [];
	for (let i = 0; i < rows.length; i++) {
		let cells: string[];
		if (sepIdx >= 0 && i === sepIdx) {
			cells = Array.from({ length: colCount }, (_, c) => formatSeparator(widths[c], aligns[c]));
		} else {
			const raw = Array.from({ length: colCount }, (_, c) => rows[i][c].trim());
			cells = formatBodyRow(raw, widths, aligns, target);
		}
		out.push(`| ${cells.join(" | ")} |`);
	}
	return out;
}

export async function justifyMarkdown(
	text: string,
	target = DEFAULT_WIDTH,
	useJev = true,
): Promise<string> {
	const lines = text.split(/\r?\n/);
	if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
	const out: string[] = [];
	let i = 0;
	while (i < lines.length) {
		if (!isTableLine(lines[i])) {
			out.push(lines[i]);
			i += 1;
			continue;
		}
		const start = i;
		while (i < lines.length && isTableLine(lines[i])) i += 1;
		const block = lines.slice(start, i);
		const parsed = block.map((x) => splitRow(x));
		if (block.length >= 2 && parsed.some((r) => isSeparatorRow(r))) {
			out.push(...(await justifyTable(block, target, useJev)));
		} else {
			out.push(...block);
		}
	}
	let result = out.join("\n");
	if (text.endsWith("\n")) result += "\n";
	return result;
}
