import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Type } from "@sinclair/typebox";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";

const EXTENSION_ID = "yolo";
const CONFIG_NAME = "yolo.json";
const YOLO_KEY = Symbol.for("my-pi.yolo.state");

type YoloFile = { sessions?: Record<string, boolean>; enabled?: boolean };
type YoloState = { currentId: string; bySession: Record<string, boolean>; ephemeral: boolean };

function emptyState(): YoloState {
	return { currentId: "", bySession: {}, ephemeral: false };
}

function configPath(): string {
	return join(getAgentDir(), "extensions", CONFIG_NAME);
}

function getState(): YoloState {
	const g = globalThis as typeof globalThis & { [YOLO_KEY]?: YoloState };
	if (!g[YOLO_KEY]) g[YOLO_KEY] = emptyState();
	return g[YOLO_KEY];
}

function readSessions(): Record<string, boolean> {
	const path = configPath();
	if (!existsSync(path)) return {};
	try {
		const parsed = JSON.parse(readFileSync(path, "utf-8")) as YoloFile;
		const out: Record<string, boolean> = {};
		if (parsed.sessions && typeof parsed.sessions === "object") {
			for (const [id, value] of Object.entries(parsed.sessions)) {
				if (id && value === true) out[id] = true;
			}
		}
		return out;
	} catch (error) {
		console.error(`Warning: Could not parse ${path}: ${error}`);
		return {};
	}
}

const SESSION_FILE_ID = /_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

function liveSessionIds(): Set<string> {
	const root = join(getAgentDir(), "sessions");
	const ids = new Set<string>();
	if (!existsSync(root)) return ids;
	const entries = readdirSync(root, { recursive: true, withFileTypes: true });
	for (const entry of entries) {
		if (!entry.isFile()) continue;
		const match = entry.name.match(SESSION_FILE_ID);
		if (match) ids.add(match[1]);
	}
	return ids;
}

function pruneSessions(bySession: Record<string, boolean>): Record<string, boolean> {
	const live = liveSessionIds();
	const sessions: Record<string, boolean> = {};
	for (const [id, value] of Object.entries(bySession)) {
		if (id && value && live.has(id)) sessions[id] = true;
	}
	return sessions;
}

function writeSessions(bySession: Record<string, boolean>): void {
	const sessions = pruneSessions(bySession);
	writeFileSync(configPath(), `${JSON.stringify({ sessions }, null, 2)}\n`);
}

export function forgetYoloSession(id: string): void {
	const trimmed = id.trim();
	if (!trimmed) return;
	const state = getState();
	delete state.bySession[trimmed];
	if (state.currentId === trimmed) {
		state.currentId = "";
		state.ephemeral = false;
	}
	const disk = readSessions();
	delete disk[trimmed];
	writeSessions(disk);
}

function sessionIdFrom(ctx: ExtensionContext): string {
	return ctx.sessionManager.getSessionId()?.trim() ?? "";
}

function bindSession(id: string): boolean {
	const state = getState();
	state.currentId = id;
	if (!id) return state.ephemeral;
	const fromFile = readSessions();
	state.bySession[id] = fromFile[id] === true;
	return state.bySession[id];
}

export function isYoloEnabled(): boolean {
	const state = getState();
	if (!state.currentId) return state.ephemeral;
	return state.bySession[state.currentId] === true;
}

function updateStatus(ctx: ExtensionContext, enabled: boolean): void {
	if (!ctx.hasUI) return;
	ctx.ui.setStatus(EXTENSION_ID, enabled ? "yolo" : "\x1b[2myolo\x1b[22m");
}

function statusMessage(enabled: boolean, ephemeral: boolean): string {
	const base = enabled
		? "YOLO mode is ON for this session: damage-control blocking is disabled. All tool calls are allowed. Run /yolo off to re-enable guardrails."
		: "YOLO mode is OFF for this session: damage-control blocking is enabled.";
	if (ephemeral) {
		return `${base} This session has no id; the flag is in-memory only.`;
	}
	return base;
}

function toolDescription(enabled: boolean): string {
	const state = enabled
		? "YOLO is ON. damage-control skipped. git write allowed."
		: "YOLO is OFF. damage-control checks tool calls. git write forbidden.";
	return `${state} Never call this tool. Status is this description. User owns /yolo. Agent never enable YOLO. Never ask user to enable it to bypass a block.`;
}

function registerYoloTool(pi: ExtensionAPI, enabled: boolean): void {
	pi.registerTool({
		name: "yolo",
		label: "Yolo",
		description: toolDescription(enabled),
		promptSnippet: "Yolo status: read yolo tool description. Never call yolo.",
		promptGuidelines: [
			"Read yolo tool description for YOLO on/off. Do not call yolo.",
			"When YOLO is ON, git write is allowed. When OFF, git stays read-only.",
		],
		parameters: Type.Object({}),
		async execute() {
			return {
				content: [{ type: "text" as const, text: toolDescription(isYoloEnabled()) }],
				details: {},
			};
		},
	});
}

export function registerYoloCommand(pi: ExtensionAPI): void {
	registerYoloTool(pi, isYoloEnabled());

	pi.on("session_start", (_event, ctx) => {
		const enabled = bindSession(sessionIdFrom(ctx));
		updateStatus(ctx, enabled);
	});

	pi.registerCommand("yolo", {
		description: "Toggle YOLO mode for this session (damage-control guardrails on/off)",
		getArgumentCompletions: (prefix) =>
			["on", "off", "status"].filter((item) => item.startsWith(prefix.toLowerCase())).map((item) => ({ value: item, label: item })),
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase();
			const id = sessionIdFrom(ctx);
			bindSession(id);
			const state = getState();
			const current = id ? state.bySession[id] === true : isYoloEnabled();
			if (action === "status") {
				ctx.ui.notify(statusMessage(current, !id), "info");
				return;
			}
			if (action && action !== "on" && action !== "off") {
				ctx.ui.notify("Usage: /yolo [on|off|status]", "warning");
				return;
			}
			const enabled = action === "on" ? true : action === "off" ? false : !current;
			if (id) {
				state.currentId = id;
				state.bySession[id] = enabled;
				const disk = readSessions();
				if (enabled) disk[id] = true;
				else delete disk[id];
				writeSessions(disk);
			} else {
				state.currentId = "";
				state.ephemeral = enabled;
			}
			updateStatus(ctx, enabled);
			ctx.ui.notify(statusMessage(enabled, !id), enabled ? "warning" : "info");
		},
	});
}
