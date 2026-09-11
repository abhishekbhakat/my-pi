import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const baseDir = dirname(fileURLToPath(import.meta.url));
import {
	acquireLock,
	backupLisaSession,
	buildLisaPrompt,
	dbPath,
	initDb,
	lockPath,
	pidAlive,
	readLock,
	releaseLock,
	recordedLisaSession,
	recordLisaSession,
} from "./lisa-db";

const EXT_ID = "lisa";
const ACTIVE_KEY = Symbol.for("my-pi.lisa.active");
const OWNER_KEY = Symbol.for("my-pi.lisa.owner");
const SNAPSHOT_KEY = Symbol.for("my-pi.lisa.snapshotTools");
const PENDING_KEY = Symbol.for("my-pi.lisa.pending");
const HERDR_SKILL = "herdr";

type Globals = typeof globalThis & {
	[ACTIVE_KEY]?: boolean;
	[OWNER_KEY]?: string;
	[SNAPSHOT_KEY]?: string[];
	[PENDING_KEY]?: boolean;
};

let ownSwitch = false;

function globals(): Globals {
	return globalThis as Globals;
}

function isActive(): boolean {
	return globals()[ACTIVE_KEY] === true;
}

function sessionLabel(ctx: ExtensionContext): string {
	try {
		return ctx.sessionManager.getSessionId() ?? "unknown";
	} catch {
		return "unknown";
	}
}

function currentFile(ctx: ExtensionContext): string | undefined {
	try {
		return ctx.sessionManager.getSessionFile();
	} catch {
		return undefined;
	}
}

function setStatus(ctx: ExtensionContext, on: boolean): void {
	if (!ctx.hasUI) return;
	ctx.ui.setStatus(EXT_ID, on ? EXT_ID : undefined);
}

const SUPPRESSED_KEYS = ["fast-mode", "yolo"];

function suppressOthers(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;
	for (const key of SUPPRESSED_KEYS) ctx.ui.setStatus(key, undefined);
}

function paintActive(ctx: ExtensionContext): void {
	setStatus(ctx, true);
	suppressOthers(ctx);
}

function activate(pi: ExtensionAPI, ctx: ExtensionContext): void {
	const g = globals();
	const file = currentFile(ctx);
	if (g[ACTIVE_KEY] === true) {
		if (file) {
			try {
				recordLisaSession(file);
			} catch {
				// Adopt best effort; session record stays as is.
			}
		}
		ctx.ui.notify("Lisa already ON in this process.", "info");
		return;
	}
	const token = randomUUID();
	let acquired: "acquired" | "held" | "stale";
	try {
		acquired = acquireLock(token, sessionLabel(ctx));
	} catch (error) {
		ctx.ui.notify(`Lisa lock failed: ${error instanceof Error ? error.message : String(error)}`, "error");
		return;
	}
	if (acquired === "held") {
		const held = readLock();
		ctx.ui.notify(`Lisa already ON (pid ${held?.pid ?? 0}, session ${held?.session ?? "unknown"}). One Lisa at a time.`, "warning");
		return;
	}
	try {
		initDb();
		if (file) recordLisaSession(file);
	} catch (error) {
		releaseLock(token);
		ctx.ui.notify(`Lisa DB init failed: ${error instanceof Error ? error.message : String(error)}`, "error");
		return;
	}
	g[SNAPSHOT_KEY] = pi.getActiveTools();
	pi.setActiveTools(["bash"]);
	g[ACTIVE_KEY] = true;
	g[OWNER_KEY] = token;
	paintActive(ctx);
	pi.appendEntry("lisa-log", { action: "on", db: dbPath() });
	ctx.ui.notify(`Lisa ON. DB ${dbPath()} (WAL). Tools: bash only. Skill: herdr only.`, "info");
}

function deactivate(pi: ExtensionAPI, ctx: ExtensionContext): void {
	const g = globals();
	if (g[ACTIVE_KEY] !== true) {
		ctx.ui.notify("Lisa already OFF.", "info");
		return;
	}
	try {
		if (g[SNAPSHOT_KEY]) pi.setActiveTools(g[SNAPSHOT_KEY]);
	} catch {
		// Tool restore must not block shutdown of Lisa mode.
	}
	const lock = readLock();
	try {
		if (lock && lock.token === g[OWNER_KEY]) unlinkSync(lockPath());
	} catch {
		// Stale lock stays; next activation reports it.
	}
	g[ACTIVE_KEY] = false;
	g[OWNER_KEY] = undefined;
	g[SNAPSHOT_KEY] = undefined;
	setStatus(ctx, false);
	pi.appendEntry("lisa-log", { action: "off" });
	ctx.ui.notify("Lisa OFF. Tools restored.", "info");
}

export default function (pi: ExtensionAPI) {
	pi.on("resources_discover", () => ({
		skillPaths: [join(baseDir, "skills", HERDR_SKILL)],
	}));

	pi.on("session_start", (_event, ctx) => {
		if (globals()[PENDING_KEY] === true) {
			globals()[PENDING_KEY] = false;
			if (!isActive()) activate(pi, ctx);
			else paintActive(ctx);
			return;
		}
		if (!isActive()) {
			setStatus(ctx, false);
			return;
		}
		paintActive(ctx);
		const file = currentFile(ctx);
		if (file) {
			try {
				recordLisaSession(file);
			} catch {
				// Record stays as is; resume uses last good entry.
			}
		}
	});

	pi.on("agent_settled", async (_event, ctx) => {
		if (!isActive()) return;
		paintActive(ctx);
		const file = currentFile(ctx);
		if (file) {
			try {
				backupLisaSession(file);
			} catch {
				// Backup best effort; transcript stays in session file.
			}
		}
	});

	pi.on("session_shutdown", (event) => {
		if (event.reason !== "quit") return;
		const g = globals();
		if (g[ACTIVE_KEY] !== true) return;
		const lock = readLock();
		try {
			if (lock && lock.token === g[OWNER_KEY]) unlinkSync(lockPath());
		} catch {
			// Process exits; next activation cleans the stale lock.
		}
		g[ACTIVE_KEY] = false;
		g[OWNER_KEY] = undefined;
		g[SNAPSHOT_KEY] = undefined;
	});

	pi.on("session_before_switch", async (event, ctx) => {
		if (!isActive() || ownSwitch) return;
		if (event.reason === "resume" && event.targetSessionFile) {
			const home = recordedLisaSession();
			if (home && event.targetSessionFile === home) return;
		}
		ctx.ui.notify("Lisa owns this session. Run /lisa off first to leave it.", "warning");
		return { cancel: true };
	});

	pi.on("session_before_fork", async (_event, ctx) => {
		if (!isActive() || ownSwitch) return;
		ctx.ui.notify("Lisa owns this session. Run /lisa off first to fork it.", "warning");
		return { cancel: true };
	});

	pi.on("tool_call", async (event) => {
		if (!isActive()) return;
		if (event.toolName === "bash") return;
		return {
			block: true,
			reason: `Lisa mode: bash only. Blocked ${event.toolName}. Use bash for sqlite3, python, or herdr commands.`,
		};
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const skills = event.systemPromptOptions.skills;
		if (!isActive()) {
			if (skills) {
				const kept = skills.filter((s) => !(s.name === HERDR_SKILL && s.filePath.includes(EXT_ID)));
				if (kept.length !== skills.length) {
					skills.length = 0;
					skills.push(...kept);
				}
			}
			return;
		}
		const all = skills ?? [];
		const bundled = all.filter((s) => s.name === HERDR_SKILL && s.filePath.includes(EXT_ID));
		const kept = bundled.length > 0 ? bundled : all.filter((s) => s.name === HERDR_SKILL);
		if (skills) {
			skills.length = 0;
			skills.push(...kept);
		}
		suppressOthers(ctx);
		event.systemPromptOptions.selectedTools = ["bash"];
		return { systemPrompt: buildLisaPrompt(kept, event.systemPromptOptions.cwd) };
	});

	pi.registerCommand("lisa", {
		description: "Toggle Lisa pilot mode (bash + herdr only, single owner, single session)",
		handler: async (_args, ctx) => {
			if (!isActive()) {
				const lock = readLock();
				if (lock && pidAlive(lock.pid) && lock.token !== globals()[OWNER_KEY]) {
					ctx.ui.notify(`Lisa already ON (pid ${lock.pid}, session ${lock.session}). One Lisa at a time.`, "warning");
					return;
				}
				const target = recordedLisaSession();
				const current = currentFile(ctx);
				if (target && current !== target && existsSync(target)) {
					ownSwitch = true;
					globals()[PENDING_KEY] = true;
					try {
						const res = await ctx.switchSession(target);
						if (res.cancelled) {
							globals()[PENDING_KEY] = false;
							ctx.ui.notify("Lisa resume cancelled.", "warning");
						}
					} catch (error) {
						globals()[PENDING_KEY] = false;
						try {
							ctx.ui.notify(`Lisa resume failed: ${error instanceof Error ? error.message : String(error)}`, "error");
						} catch {
							// Session tore down; nothing left to notify through.
						}
					} finally {
						ownSwitch = false;
					}
					return;
				}
				activate(pi, ctx);
				return;
			}
			deactivate(pi, ctx);
			await ctx.newSession();
		},
	});
}
