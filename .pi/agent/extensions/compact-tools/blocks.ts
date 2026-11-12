import type { Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { Container, MouseRegion, truncateToWidth } from "@earendil-works/pi-tui";
import { stripVTControlCharacters } from "node:util";
import { buildBlockLines, WidthAwareLines } from "#compact-cards";
import { DIM, INDENT, RESET } from "#compact-constants";

export type BlockStatus = "running" | "done" | "error";
export interface CompactBlockData {
	name: string;
	icon?: string;
	detail?: string;
	summary: string;
	full: string;
	status?: BlockStatus;
}

type TextPart = { type: string; text?: string };

export function cleanBlockText(value: string): string {
	return stripVTControlCharacters(value).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
}

export function blockText(content: string | TextPart[]): string {
	return cleanBlockText(typeof content === "string" ? content : content
		.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n"));
}

export function blockOneLine(text: string): string {
	return cleanBlockText(text).replace(/\s+/g, " ").trim();
}

export function blockPreview(text: string): string {
	const first = text.split("\n").find((line) => line.trim()) ?? "";
	if (/^[\[{]/.test(first.trim())) {
		try {
			const value = JSON.parse(text);
			if (Array.isArray(value)) return `${value.length} entries`;
			if (value && typeof value === "object") return Object.keys(value).join(", ") || "Empty result";
		} catch { /* Text beginning with a bracket need not be JSON. */ }
	}
	return blockOneLine(first).slice(0, 240);
}

export function blockArguments(args: Record<string, unknown> = {}): string {
	if (typeof args.task === "string") return blockOneLine(args.task);
	if (typeof args.code === "string") return blockPreview(args.code);
	const fields = ["action", "id", "label", "path", "pattern", "to", "number", "name", "goal"];
	const parts = fields.map((key) => args[key]).filter((value) => typeof value === "string" || typeof value === "number");
	if (Array.isArray(args.questions)) parts.push(`${args.questions.length} questions`);
	return blockOneLine(parts.join(" "));
}

/** No Box or outputPad. Uses the same gutter, line painter, and backgrounds as bash. */
export class CompactBlock extends Container {
	constructor(
		private readonly data: CompactBlockData,
		private readonly theme: Theme,
		private expanded: boolean,
		private readonly onToggle?: (expanded: boolean) => void,
	) { super(); this.rebuild(); }

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.onToggle?.(expanded);
		this.rebuild();
	}

	private rebuild(): void {
		this.clear();
		const status = this.data.status ?? "done";
		const bg = (value: string) => this.theme.bg(status === "running" ? "toolPendingBg" : status === "error" ? "toolErrorBg" : "toolSuccessBg", value);
		const body = {
			render: (width: number) => {
				const lines = buildBlockLines({
					...this.data,
					name: blockOneLine(this.data.name), detail: blockOneLine(this.data.detail ?? ""), summary: blockOneLine(this.data.summary),
					isPartial: status === "running", isError: status === "error",
					expandedLines: this.expanded ? cleanBlockText(this.data.full).split("\n").map((line) => `${INDENT}${DIM}${line}${RESET}`) : [],
				});
				// Truncate collapsed rows from the right, preserving the dotted gutter at narrow widths.
				return new WidthAwareLines(this.expanded ? lines : lines.map((line) => truncateToWidth(line, Math.max(1, width), "…")), bg, { wrap: this.expanded }).render(width);
			},
			invalidate() {},
		};
		this.addChild(new MouseRegion(body, (event) => {
			if (event.type !== "click" || event.button !== "left") return;
			this.setExpanded(!this.expanded);
			return { handled: true };
		}));
	}
}

export interface CompactToolOptions {
	icon?: string;
	fallbackTask?: string;
	summary?: (text: string) => string;
}

/** Exactly one two-line block across both tool slots, including partial results. */
export function compactToolRenderers(name: string, options: CompactToolOptions = {}): ToolRenderers {
	return {
		renderShell: "self",
		renderCall(args, theme, context) {
			const input = (args ?? {}) as Record<string, unknown>;
			const full = typeof input.code === "string" ? input.code : JSON.stringify(input, null, 2);
			const component = new CompactBlock({
				name, icon: options.icon, detail: blockArguments(input) || options.fallbackTask,
				summary: "running", full, status: "running",
			}, theme, context.expanded);
			// Result rendering runs after call rendering. Check state during paint, not construction.
			return {
				render: (width) => context.state.compactBlockHasResult ? [] : component.render(width),
				invalidate: () => component.invalidate(),
				handleMouse: (event) => component.handleMouse(event),
			};
		},
		renderResult(result, optionsResult, theme, context) {
			const state = context.state;
			state.compactBlockHasResult = true;
			if (state.compactBlockHostExpanded !== optionsResult.expanded) {
				state.compactBlockHostExpanded = optionsResult.expanded;
				state.compactBlockExpanded = optionsResult.expanded;
			}
			const details = result.details as { status?: string; id?: string } | undefined;
			const text = blockText(result.content);
			const failed = context.isError || ["error", "aborted", "cancelled"].includes(details?.status ?? "");
			const launch = details?.status === "running" && Boolean(details.id) && !optionsResult.isPartial && text.startsWith("Started ");
			const status: BlockStatus = failed ? "error" : optionsResult.isPartial || details?.status === "running" || details?.status === "cancelling" ? "running" : "done";
			const input = (context.args ?? {}) as Record<string, unknown>;
			const fullArgs = typeof input.code === "string" ? input.code : JSON.stringify(input, null, 2);
			const summary = launch ? `Started ${details!.id}` : options.summary?.(text) || blockPreview(text) || status;
			return new CompactBlock({
				name, icon: options.icon, detail: blockArguments(input) || options.fallbackTask,
				summary, full: `${fullArgs}\n\n${text}`, status,
			}, theme, state.compactBlockExpanded, (expanded) => { state.compactBlockExpanded = expanded; });
		},
	};
}
