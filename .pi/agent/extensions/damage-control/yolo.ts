import { Type } from "@sinclair/typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const EXTENSION_ID = "yolo";
const YOLO_KEY = Symbol.for("my-pi.yolo.state");

type YoloState = { enabled: boolean; currentId: string };
type YoloData = { enabled?: unknown };

function getState(): YoloState {
	const g = globalThis as typeof globalThis & { [YOLO_KEY]?: YoloState };
	if (!g[YOLO_KEY]) g[YOLO_KEY] = { enabled: false, currentId: "" };
	return g[YOLO_KEY];
}

function sessionIdFrom(ctx: ExtensionContext): string {
	return ctx.sessionManager.getSessionId()?.trim() ?? "";
}

function isYoloData(value: unknown): value is YoloData {
	return typeof value === "object" && value !== null && "enabled" in value;
}

function restore(ctx: ExtensionContext, forceOff = false): boolean {
	const state = getState();
	state.currentId = sessionIdFrom(ctx);
	if (forceOff) {
		state.enabled = false;
		return false;
	}
	state.enabled = false;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type === "custom" && entry.customType === EXTENSION_ID && isYoloData(entry.data)) {
			state.enabled = entry.data.enabled === true;
		}
	}
	return state.enabled;
}

export function isYoloEnabled(): boolean {
	return getState().enabled;
}

export function forgetYoloSession(_id: string): void {
	// Kept for extension API compatibility. YOLO state now lives in session entries.
}

function updateStatus(ctx: ExtensionContext, enabled: boolean): void {
	if (!ctx.hasUI) return;
	ctx.ui.setStatus(EXTENSION_ID, enabled ? "yolo" : "\x1b[2myolo\x1b[22m");
}

function statusMessage(enabled: boolean, ephemeral: boolean): string {
	const base = enabled
		? "YOLO mode is ON for this session: damage-control blocking is disabled. All tool calls are allowed. Run /yolo off to re-enable guardrails."
		: "YOLO mode is OFF for this session: damage-control blocking is enabled.";
	if (ephemeral) return `${base} This session has no id; the flag is in-memory only.`;
	return base;
}

function statusText(enabled: boolean): string {
	const state = enabled
		? "YOLO is ON. damage-control skipped. No prompts, no blocks."
		: "YOLO is OFF. damage-control checks tool calls. Risky commands prompt user allow/deny. Protected paths hard-blocked.";
	return `${state} YOLO does not expand what the user requested. /yolo is user-controlled.`;
}

function registerYoloTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "yolo",
		label: "Yolo",
		description: "Read-only YOLO status tool. Returns current session state as ON or OFF. State can change via /yolo, so call this tool when status matters instead of assuming.",
		promptSnippet: "Yolo status: call this status-only tool when current ON/OFF state matters.",
		promptGuidelines: [
			"Call yolo when user asks about YOLO or before destructive commands if status is unknown.",
			"Never toggle YOLO with this tool. /yolo command is user-controlled.",
			"YOLO ON disables damage-control checks; it does not expand what the user requested.",
		],
		parameters: Type.Object({}),
		async execute() {
			return {
				content: [{ type: "text" as const, text: statusText(isYoloEnabled()) }],
				details: {},
			};
		},
	});
}

export function registerYoloCommand(pi: ExtensionAPI): void {
	registerYoloTool(pi);

	pi.on("session_start", (event, ctx) => {
		const isFork = event.reason === "fork";
		const enabled = restore(ctx, isFork);
		if (isFork) pi.appendEntry(EXTENSION_ID, { enabled: false });
		updateStatus(ctx, enabled);
	});

	pi.on("session_tree", (_event, ctx) => {
		const enabled = restore(ctx);
		updateStatus(ctx, enabled);
	});

	pi.registerCommand("yolo", {
		description: "Toggle YOLO mode for this session (damage-control guardrails on/off)",
		getArgumentCompletions: (prefix) =>
			["on", "off", "status"].filter((item) => item.startsWith(prefix.toLowerCase())).map((item) => ({ value: item, label: item })),
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase();
			const id = sessionIdFrom(ctx);
			const state = getState();
			state.currentId = id;
			const current = state.enabled;
			if (action === "status") {
				ctx.ui.notify(statusMessage(current, !id), "info");
				return;
			}
			if (action && action !== "on" && action !== "off") {
				ctx.ui.notify("Usage: /yolo [on|off|status]", "warning");
				return;
			}
			const enabled = action === "on" ? true : action === "off" ? false : !current;
			state.enabled = enabled;
			if (id) pi.appendEntry(EXTENSION_ID, { enabled });
			updateStatus(ctx, enabled);
			ctx.ui.notify(statusMessage(enabled, !id), enabled ? "warning" : "info");
		},
	});
}
