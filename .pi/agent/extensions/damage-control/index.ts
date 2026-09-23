import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { commandNeedsSemanticReview, evaluatePathGuards, parseShellCommand } from "./bash";
import { sensitiveWriteReason } from "./paths";
import { needsSemanticReview, reviewSemanticRisk, type SemanticRisk } from "./semantic";
import { getLatestUserMessage } from "./user-prompt";
import { isYoloEnabled, registerYoloCommand } from "./yolo";

export default function (pi: ExtensionAPI) {
	registerYoloCommand(pi);

	pi.on("session_start", async (_event, ctx) => {
		ctx.ui.setStatus(isYoloEnabled() ? "YOLO: damage-control disabled" : "Damage-Control Active");
	});

	pi.on("tool_call", async (event, ctx) => {
		if (isYoloEnabled()) return { block: false };

		let violationReason: string | null = null;
		let violationCommand: string | null = null;
		let shouldAsk = false;
		let semanticRisk: SemanticRisk | null = null;

		if (isToolCallEventType("write", event) || isToolCallEventType("edit", event)) {
			violationReason = sensitiveWriteReason(event.input.path, ctx.cwd);
		} else if (isToolCallEventType("bash", event)) {
			const command = event.input.command;
			violationReason = evaluatePathGuards(command, ctx.cwd);
			if (violationReason) {
				const parsedCommands = parseShellCommand(command);
				if (parsedCommands.length === 1) {
					violationCommand = parsedCommands[0].fullCommand;
				} else {
					const hit = parsedCommands.find((parsed) => evaluatePathGuards(parsed.fullCommand, ctx.cwd));
					if (hit) violationCommand = hit.fullCommand;
				}
			}

			if (!violationReason && commandNeedsSemanticReview(command, needsSemanticReview)) {
				const review = await reviewSemanticRisk(command, ctx.cwd, {
					lastUserPrompt: getLatestUserMessage(ctx),
				});
				if (review.status === "risk") {
					semanticRisk = review.risk;
					violationReason = `Guardrails violation (${semanticRisk.probability.toFixed(2)})`;
					shouldAsk = true;
				} else if (review.status === "unavailable") {
					violationReason = `TypeSafe review unavailable: ${review.reason}`;
					shouldAsk = true;
				}
				const parsedCommands = parseShellCommand(command);
				if (violationReason && parsedCommands.length === 1) {
					violationCommand = parsedCommands[0].fullCommand;
				}
			}
		}

		const formatBlockReason = (deniedByUser: boolean) => {
			const isBash = isToolCallEventType("bash", event);
			const commandDetails = isBash
				? violationCommand
					? `\n\nBlocked subcommand: \`${violationCommand}\`\nFull command: \`${event.input.command}\``
					: `\n\nFull command: \`${event.input.command}\``
				: "";
			const scopeNote = violationCommand
				? "\n\nThis block was triggered by the subcommand above. No part of the compound command was executed. If another subcommand is still needed, submit it separately; it will be checked independently."
				: "";
			return (
				`BLOCKED by Damage-Control: ${violationReason}${deniedByUser ? " (User denied)" : ""}${commandDetails}${scopeNote}` +
				"\n\nDo not retry the blocked operation or work around this restriction through aliases, wrappers, alternate syntax, or equivalent commands. Report this block to the user and ask how they would like to proceed."
			);
		};

		if (!violationReason) return { block: false };

		if (shouldAsk) {
			const confirmed = await ctx.ui.confirm(
				"Damage-Control Confirmation",
				`Dangerous command detected: ${violationReason}\n\nBlocked part: ${violationCommand ?? (isToolCallEventType("bash", event) ? "whole command" : JSON.stringify(event.input))}\n\nCommand: ${isToolCallEventType("bash", event) ? event.input.command : JSON.stringify(event.input)}\n\nDo you want to proceed?`,
				{ timeout: 30000 },
			);

			if (!confirmed) {
				ctx.ui.setStatus(`Last Violation Blocked: ${violationReason.slice(0, 30)}...`);
				pi.appendEntry("damage-control-log", {
					tool: event.toolName,
					input: event.input,
					reason: violationReason,
					action: "blocked_by_user",
					...(violationCommand ? { blockedCommand: violationCommand } : {}),
					...(semanticRisk ? { semanticRisk } : {}),
				});
				return { block: true, reason: formatBlockReason(true) };
			}

			pi.appendEntry("damage-control-log", {
				tool: event.toolName,
				input: event.input,
				reason: violationReason,
				action: "confirmed_by_user",
				...(semanticRisk ? { semanticRisk } : {}),
			});
			return { block: false };
		}

		ctx.ui.notify(
			`Damage-Control: Blocked ${event.toolName}${violationCommand ? ` subcommand \`${violationCommand}\`` : ""} due to ${violationReason}`,
		);
		ctx.ui.setStatus(`Last Violation: ${(violationCommand ?? violationReason).slice(0, 30)}...`);
		pi.appendEntry("damage-control-log", {
			tool: event.toolName,
			input: event.input,
			reason: violationReason,
			action: "blocked",
			...(violationCommand ? { blockedCommand: violationCommand } : {}),
		});
		return { block: true, reason: formatBlockReason(false) };
	});
}
