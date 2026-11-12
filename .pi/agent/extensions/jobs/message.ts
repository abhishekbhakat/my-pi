import type { Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { CompactBlock, compactToolRenderers } from "#compact-blocks";
import { compactJobSummary } from "./format.ts";

type JobTone = "success" | "error" | "pending";

export const jobToolRenderers: ToolRenderers = compactToolRenderers("jobs", { icon: "$", summary: compactJobSummary });

/** Job exit notifications use the same two-line shape as the jobs tool. */
export class JobMessageComponent extends CompactBlock {
	constructor(summary: string, full: string, theme: Theme, expanded: boolean, tone: JobTone) {
		super({
			name: "jobs", icon: "$", summary: compactJobSummary(summary), full,
			status: tone === "error" ? "error" : tone === "pending" ? "running" : "done",
		}, theme, expanded);
	}
}
