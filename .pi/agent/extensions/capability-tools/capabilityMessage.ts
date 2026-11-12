import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { CompactBlock, blockOneLine, blockPreview, blockText, compactToolRenderers } from "#compact-blocks";

export const oneLine = blockOneLine;

/** Call and result slots share one two-line block through the row-local state. */
export function renderCapabilityCall(label: string, fallbackTask: string): NonNullable<ToolDefinition["renderCall"]> {
	return compactToolRenderers(label, { fallbackTask }).renderCall!;
}

export const renderCapabilityJobsCall: NonNullable<ToolDefinition["renderCall"]> = compactToolRenderers("Capability jobs").renderCall!;

export function renderCapabilityResult(label: string): NonNullable<ToolDefinition["renderResult"]> {
	return compactToolRenderers(label).renderResult!;
}

export const renderScoutResult = renderCapabilityResult("Code Scout");

export function registerCapabilityMessages(pi: ExtensionAPI): void {
	pi.registerMessageRenderer("capability_result", (message, options, theme) => {
		const details = message.details as { capability?: string; status?: string; id?: string } | undefined;
		const full = blockText(message.content);
		const status = details?.status ?? "done";
		return new CompactBlock({
			name: details?.capability ?? "Capability",
			detail: details?.id,
			summary: `${status} | ${blockPreview(full.split("\n").slice(1).join("\n")) || blockPreview(full)}`,
			full,
			status: ["running", "cancelling"].includes(status) ? "running" : status === "done" ? "done" : "error",
		}, theme, options.expanded);
	});
}
