import { writeFileSync } from "node:fs";
import * as path from "node:path";
import { coderSession, snapshotContext, stripSkillCatalog, type CapabilitySkill } from "#capability-snapshot";
import { coderRpc, type CoderRpcOptions } from "#capability-coder-rpc";
import type { CapabilityBackground } from "#capability-background";
import type { CapabilityDef, CapabilityToolInput } from "#capability-types";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const CAPABILITY_CHILD_ENV = "PI_CAPABILITY_CHILD";

export function startCoder(background: CapabilityBackground, def: CapabilityDef, input: CapabilityToolInput, ctx: ExtensionContext, skills: readonly CapabilitySkill[]) {
	const snapshot = snapshotContext(ctx);
	const session = coderSession(snapshot.sessionManager.getBranch(), snapshot.cwd);
	const systemPrompt = `${stripSkillCatalog(snapshot.getSystemPrompt())}\n\n${def.systemPrompt}`;
	const task = [input.task, input.paths?.length ? `Assigned paths:\n${input.paths.join("\n")}` : ""].filter(Boolean).join("\n\n");
	const thinking = def.reasoningEffort ?? "high";
	return background.start("coder", ctx, (signal, directory, channel) => runCoderChild({
		cwd: snapshot.cwd, model: def.model, thinking,
		session, systemPrompt, task, directory, signal, channel, skillPaths: skills.map(skill => skill.filePath),
	}), { model: def.model, effort: thinking });
}

export interface CoderChildOptions extends CoderRpcOptions {
	session: string;
	systemPrompt: string;
}

export async function runCoderChild(options: CoderChildOptions) {
	if (options.signal.aborted) throw new Error("Coder cancelled before launch.");
	writeFileSync(path.join(options.directory, "session.jsonl"), options.session, { mode: 0o600 });
	writeFileSync(path.join(options.directory, "system.md"), options.systemPrompt, { mode: 0o600 });
	writeFileSync(path.join(options.directory, "task.txt"), options.task, { mode: 0o600 });
	const text = await coderRpc(options);
	return { content: [{ type: "text" as const, text }], details: { status: "done", directory: options.directory } };
}

export function registerCoderCommand(pi: ExtensionAPI): void {
	pi.registerCommand("coder", {
		description: "Toggle coder tool. Subcommands: on, off, status",
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase();
			const active = pi.getActiveTools();
			const enabled = active.includes("coder");
			if (action === "status") { ctx.ui.notify(`Coder ${enabled ? "enabled" : "disabled"}.`, "info"); return; }
			if (action && !["on", "off", "toggle"].includes(action)) {
				ctx.ui.notify("Use /coder, /coder on, /coder off, or /coder status.", "warning"); return;
			}
			const enable = action === "on" || (action !== "off" && !enabled);
			pi.setActiveTools(enable ? [...new Set([...active, "coder"])] : active.filter((name) => name !== "coder"));
			ctx.ui.notify(`Coder ${enable ? "enabled" : "disabled"}. Existing runs continue; stop with capability_jobs.`, "info");
		},
	});
}
