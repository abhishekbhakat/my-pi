import { Box, Container, MouseRegion, Text, truncateToWidth } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { stripVTControlCharacters } from "node:util";

/** Compact completion row with mouse and host expansion support. */
export class CapabilityMessageComponent extends Container {
	constructor(
		private readonly summary: string,
		private readonly full: string,
		private readonly outputPad: number,
		private readonly theme: any,
		private expanded: boolean,
		private readonly status: string,
	) { super(); this.rebuild(); }

	setExpanded(expanded: boolean): void { this.expanded = expanded; this.rebuild(); }

	private rebuild(): void {
		this.clear();
		const color = this.status === "done" ? "toolSuccessBg" : this.status === "running" ? "toolPendingBg" : "toolErrorBg";
		const bg = (value: string) => this.theme.bg(color, value);
		const prefix = this.theme.fg("accent", "[capability] ");
		const body = this.expanded
			? new Text(prefix + this.full + this.theme.fg("dim", "\n(click to collapse)"), 1, 1, bg)
			: {
				render: (width: number) => [bg(truncateToWidth(prefix + this.summary + this.theme.fg("dim", " (click or ctrl+o)"), width, "...", true))],
				invalidate() {},
			};
		const box = new Box(this.outputPad, this.expanded ? 1 : 0, bg);
		box.addChild(body);
		this.addChild(new MouseRegion(box, (event) => {
			if (event.type !== "click" || event.button !== "left") return;
			this.setExpanded(!this.expanded);
			return { handled: true };
		}));
	}
}

/** Keep scout tool output compact without trimming model-facing results. */
export const renderScoutResult: NonNullable<ToolDefinition["renderResult"]> = (result, options, theme, context) => {
	const raw = result.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
	const full = stripVTControlCharacters(raw).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
	const details = result.details as { status?: string } | undefined;
	const failed = context.isError || details?.status === "error" || details?.status === "aborted";
	const status = failed ? "error" : options.isPartial ? "running" : "done";
	const preview = (full.split("\n").find((line) => line.trim()) ?? "").trim().slice(0, 160);
	const summary = `Code Scout ${options.isPartial && !failed ? details?.status ?? "running" : status} | ${preview}`;
	return new CapabilityMessageComponent(summary, full, 0, theme, options.expanded, status);
};

export function registerCapabilityMessages(pi: ExtensionAPI): void {
	pi.registerMessageRenderer("capability_result", (message, options, theme) => {
		const details = message.details as { capability?: string; status?: string; id?: string } | undefined;
		const raw = typeof message.content === "string" ? message.content : message.content
			.filter((part) => part.type === "text").map((part) => part.text).join("\n");
		const full = stripVTControlCharacters(raw).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
		const status = details?.status ?? "done";
		const summary = `${details?.capability ?? "Capability"} ${status} | ${details?.id ?? full.split("\n")[0]}`.replace(/\s+/g, " ");
		return new CapabilityMessageComponent(summary, full, options.outputPad, theme, options.expanded, status);
	});
}
