import type { ExtensionAPI, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { Box, Container, MouseRegion, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { stripVTControlCharacters } from "node:util";

function clean(value: string): string {
	return stripVTControlCharacters(value).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
}

class CodemodeResult extends Container {
	constructor(
		private readonly summary: string,
		private readonly full: string,
		private readonly theme: any,
		private readonly padding: number,
		private readonly error: boolean,
		private readonly partial: boolean,
		private expanded: boolean,
		private readonly remember: (expanded: boolean) => void,
	) { super(); this.rebuild(); }

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.remember(expanded);
		this.rebuild();
	}

	private rebuild(): void {
		this.clear();
		const bg = (value: string) => this.theme.bg(this.error ? "toolErrorBg" : this.partial ? "toolPendingBg" : "toolSuccessBg", value);
		const body = this.expanded
			? new Text(this.full + this.theme.fg("dim", "\n(click to collapse)"), 1, 1, bg)
			: {
				render: (width: number) => [bg(truncateToWidth(this.theme.fg("accent", "[codemode] ") + this.summary + this.theme.fg("dim", " (click or ctrl+o)"), width, "...", true))],
				invalidate() {},
			};
		const box = new Box(this.padding, this.expanded ? 1 : 0, bg);
		box.addChild(body);
		this.addChild(new MouseRegion(box, (event) => {
			if (event.type !== "click" || event.button !== "left") return;
			this.setExpanded(!this.expanded);
			return { handled: true };
		}));
	}
}

export const compactCodemodeRenderers: ToolRenderers = {
	renderShell: "self",
	renderCall(_args, theme, context) {
		return {
			render: (width: number) => context.state.compactHasResult ? [] : [truncateToWidth(theme.fg("accent", "[codemode] running"), width, "...", true)],
			invalidate() {},
		};
	},
	renderResult(result, options, theme, context) {
		const state = context.state;
		state.compactHasResult = true;
		if (state.compactHostExpanded !== options.expanded) {
			state.compactHostExpanded = options.expanded;
			state.compactExpanded = options.expanded;
		}
		const args = context.args as { code?: string };
		const code = clean(args.code ?? "");
		const output = clean(result.content.filter((part) => part.type === "text").map((part) => part.text).join("\n"));
		const status = context.isError ? "error" : options.isPartial ? "running" : "done";
		const preview = (output.split("\n").find((line) => line.trim()) ?? "").trim().slice(0, 160);
		const summary = `${status}${preview ? ` | ${preview}` : ""}`;
		return new CodemodeResult(summary, `codemode\n${code}\n\n${output}`, theme, context.outputPad, context.isError, options.isPartial,
			state.compactExpanded, (expanded) => { state.compactExpanded = expanded; });
	},
};

/** Change only presentation; keep the built-in codemode tool and execution guards. */
export function registerCompactCodemode(pi: ExtensionAPI): void {
	pi.registerToolRenderer((name, next) => name === "codemode" ? { ...next(), ...compactCodemodeRenderers } : next());
}
