import { copyToClipboard, type AgentToolUpdateCallback, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { closeCapabilityPanel, setPanelEscape, showCapabilityPanel, updateCapabilityPanel } from "./panel";
import { executeCapability } from "./runner";
import type { CapabilityDef } from "./types";

const DEFAULT_TASKS: Record<string, string> = {
	patch_reviewer: "Review current changes for correctness risks, regressions, and missing tests.",
	commit_message: "Generate a concise one-line conventional commit message from staged changes.",
};

function resultText(result: { content?: Array<{ type: string; text?: string }> }): string {
	return (result.content ?? [])
		.filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("\n")
		.trim();
}

function resultStatus(result: { details?: unknown }): string {
	if (!result.details || typeof result.details !== "object") return "done";
	const status = (result.details as { status?: unknown }).status;
	return typeof status === "string" ? status : "done";
}

async function runCapabilityCommand(
	pi: ExtensionAPI,
	def: CapabilityDef,
	ctx: ExtensionCommandContext,
	task: string,
	paths?: string[],
): Promise<void> {
	if (!ctx.isIdle()) {
		ctx.ui.notify("Agent busy. Wait or abort first.", "warning");
		return;
	}

	const controller = new AbortController();
	setPanelEscape(() => controller.abort());
	await showCapabilityPanel(ctx, {
		title: def.label,
		body: "Assembling context...",
		status: "running",
	});

	const onUpdate: AgentToolUpdateCallback = (update) => {
		const preview = resultText(update);
		updateCapabilityPanel({
			title: def.label,
			body: preview || "Working...",
			status: "streaming",
		});
	};

	try {
		const result = await executeCapability(
			pi,
			def,
			{ task, paths, previewLines: 4 },
			controller.signal,
			onUpdate,
			ctx,
		);
		const rawText = resultText(result);
		const status = controller.signal.aborted ? "aborted" : resultStatus(result);
		const failed = status === "error" || status === "aborted";
		const copyable = Boolean(rawText) && !rawText.startsWith("No staged changes");

		closeCapabilityPanel();

		if (failed) {
			if (ctx.hasUI) ctx.ui.notify(`${def.label} ${status}.`, status === "aborted" ? "warning" : "error");
			return;
		}

		let copied = false;
		if (copyable) {
			try {
				await copyToClipboard(rawText);
				copied = true;
			} catch {
				copied = false;
			}
		}

		pi.events.emit("capability:complete", { toolName: def.toolName, label: def.label });

		if (!ctx.hasUI) return;
		if (copied) ctx.ui.notify(`${def.label} done. Copied.`, "info");
		else if (copyable) ctx.ui.notify(`${def.label} done. Clipboard copy failed.`, "warning");
		else ctx.ui.notify(`${def.label} done.`, "info");
	} catch (error) {
		closeCapabilityPanel();
		if (controller.signal.aborted) {
			if (ctx.hasUI) ctx.ui.notify(`${def.label} aborted.`, "warning");
			return;
		}
		const message = error instanceof Error ? error.message : "Capability call failed";
		if (ctx.hasUI) ctx.ui.notify(`${def.label} failed: ${message}`, "error");
	}
}

export function registerCapabilityCommands(pi: ExtensionAPI, capabilities: CapabilityDef[]): void {
	const byTool = new Map(capabilities.map((def) => [def.toolName, def]));
	const patchReviewer = byTool.get("patch_reviewer");
	const commitMessage = byTool.get("commit_message");

	if (patchReviewer) {
		pi.registerCommand("patch-review", {
			description: "Review current changes with Patch Reviewer",
			handler: async (args, ctx) => {
				const note = args.trim();
				await runCapabilityCommand(
					pi,
					patchReviewer,
					ctx,
					note || DEFAULT_TASKS.patch_reviewer,
				);
			},
		});
	}

	if (commitMessage) {
		pi.registerCommand("commit-message", {
			description: "Generate commit message from staged diff",
			handler: async (args, ctx) => {
				const pathArg = args.trim();
				await runCapabilityCommand(
					pi,
					commitMessage,
					ctx,
					DEFAULT_TASKS.commit_message,
					pathArg ? [pathArg] : undefined,
				);
			},
		});
	}
}
