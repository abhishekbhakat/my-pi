import { visibleWidth } from "@mariozechner/pi-tui";
import type { AgentInstance } from "./types";

export function renderCard(inst: AgentInstance, width: number, theme: any): string[] {
	if (width <= 0) return [""];
	if (width < 4) {
		const tiny = `${inst.def.name} #${inst.id}`.slice(0, width);
		return [tiny];
	}

	const boxWidth = width;
	const innerWidth = boxWidth - 2;
	const contentWidth = Math.max(1, innerWidth - 1);

	const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
	const sanitizeSingleLine = (s: string): string =>
		stripAnsi(s)
			.replace(/[\r\n\t]+/g, " ")
			.replace(/[\x00-\x1F\x7F]/g, " ")
			.replace(/\s+/g, " ")
			.trim();

	const truncatePlain = (s: string, max: number): string => {
		if (max <= 0) return "";
		if (visibleWidth(s) <= max) return s;
		if (max <= 3) return ".".repeat(max);
		const target = max - 3;
		let out = "";
		let used = 0;
		for (const ch of s) {
			const w = visibleWidth(ch);
			if (used + w > target) break;
			out += ch;
			used += w;
		}
		return out + "...";
	};

	const padRightPlain = (s: string, target: number): string => {
		const pad = Math.max(0, target - visibleWidth(s));
		return s + " ".repeat(pad);
	};

	const statusColor = inst.status === "running" ? "accent"
		: inst.status === "done" ? "success" : "error";
	const statusIcon = inst.status === "running" ? "●"
		: inst.status === "done" ? "✓" : "✗";

	const namePlain = truncatePlain(
		sanitizeSingleLine(`${inst.def.name} #${inst.id}`),
		contentWidth,
	);

	const modelShort = sanitizeSingleLine(inst.def.model.split("/").pop() || inst.def.model);
	const turnStr = inst.turnCount > 1 ? ` · Turn ${inst.turnCount}` : "";
	const statusPlain = truncatePlain(
		sanitizeSingleLine(`${statusIcon} ${inst.status} ${Math.round(inst.elapsed / 1000)}s · ${turnStr} | ${modelShort}`),
		contentWidth,
	);

	const latestChunk = inst.textChunks.length > 0 ? inst.textChunks[inst.textChunks.length - 1] : "";
	const workSource = sanitizeSingleLine(latestChunk || inst.task);
	const workPlain = truncatePlain(workSource, contentWidth);

	const makeRow = (plain: string, color?: string, bold?: boolean): string => {
		const withLead = " " + plain;
		const padded = padRightPlain(withLead, innerWidth);
		const styled = bold
			? theme.bold(padded)
			: padded;
		const colored = color ? theme.fg(color, styled) : styled;
		return theme.fg("dim", "│") + colored + theme.fg("dim", "│");
	};

	const top = theme.fg("dim", "┌" + "─".repeat(innerWidth) + "┐");
	const bottom = theme.fg("dim", "└" + "─".repeat(innerWidth) + "┘");

	return [
		top,
		makeRow(namePlain, "accent", true),
		makeRow(statusPlain, statusColor),
		makeRow(workPlain, "muted"),
		bottom,
	];
}
