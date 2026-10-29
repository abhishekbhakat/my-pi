import { Box, Container, MouseRegion, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { compactJobSummary } from "./format.ts";

type JobTone = "success" | "error" | "pending";

/** One terminal row while collapsed; full log on click or the host expansion shortcut. */
export class JobMessageComponent extends Container {
	constructor(
		private readonly summary: string,
		private readonly full: string,
		private readonly outputPad: number,
		private readonly theme: any,
		private expanded: boolean,
		private readonly tone: JobTone,
	) {
		super();
		this.rebuild();
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.rebuild();
	}

	private rebuild(): void {
		this.clear();
		const head = this.theme.fg("accent", "[job] ");
		const bgName = this.tone === "error" ? "toolErrorBg" : this.tone === "pending" ? "toolPendingBg" : "toolSuccessBg";
		const bg = (value: string) => this.theme.bg(bgName, value);
		const content = this.expanded
			? new Text(head + this.full + this.theme.fg("dim", "\n(click to collapse)"), 1, 1, bg)
			: {
				render: (width: number) => [bg(truncateToWidth(head + compactJobSummary(this.summary) + this.theme.fg("dim", " (click or ctrl+o)"), width, "...", true))],
				invalidate: () => {},
			};
		const box = new Box(this.outputPad, this.expanded ? 1 : 0, bg);
		box.addChild(content);
		this.addChild(new MouseRegion(box, (event) => {
			if (event.type !== "click" || event.button !== "left") return;
			this.setExpanded(!this.expanded);
			return { handled: true };
		}));
	}
}
