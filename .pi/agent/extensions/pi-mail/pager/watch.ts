import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { errorCode, unlinkIfPresent } from "../names/lock.ts";
import { isPagerKey, type PagerPresence } from "../names/registry.ts";
import { PAGE_TTL_MS, pagerDirectory, pagerProcessDirectory, prunePagerProcesses, readPage } from "./send.ts";
import { readProcessStarts } from "../names/process.ts";

const POLL_MS = 1_000;
type PendingPage = { text: string; hop: number; queuedAt: number };

export type PagerReceiver = {
	presence: PagerPresence;
	nextHop(): number;
	acknowledge(text: string): Promise<void>;
	setRunning(running: boolean): void;
	settled(): void;
	close(quitting: boolean): Promise<void>;
};

export async function watchPager(
	pi: ExtensionAPI, ctx: ExtensionContext, mailDir: string, sessionId: string,
): Promise<PagerReceiver> {
	const lastActiveMs = Date.now();
	const pid = process.pid;
	const start = (await readProcessStarts([pid])).get(pid);
	if (!start) throw new Error("Could not determine pager process start time");
	const presence = { key: randomUUID(), lastActiveMs, cwd: resolve(ctx.cwd) };
	const processDirectory = pagerProcessDirectory(mailDir, pid, start);
	const directory = pagerDirectory(processDirectory, presence.key);
	await mkdir(directory, { recursive: true, mode: 0o700 });
	void prunePagerProcesses(mailDir).catch(() => {});

	const pending = new Map<string, PendingPage>();
	let activeHop: number | undefined;
	let running = false;
	let watcher: FSWatcher | undefined;
	let closed = false;
	let draining = false;
	let reportedError = false;

	const reportError = (error: unknown) => {
		if (!closed && !reportedError && ctx.hasUI) {
			reportedError = true;
			ctx.ui.notify(`Pager receive error: ${error instanceof Error ? error.message : String(error)}`, "warning");
		}
	};

	const drain = async () => {
		if (closed || draining) return;
		draining = true;
		try {
			const now = Date.now();
			if (ctx.isIdle() && !ctx.hasPendingMessages()) {
				for (const [id, page] of pending) if (now - page.queuedAt >= PAGE_TTL_MS) pending.delete(id);
			}
			for (const file of await readdir(directory)) {
				if (closed || ctx.sessionManager.getSessionId() !== sessionId) break;
				const dot = file.lastIndexOf(".");
				const id = file.slice(0, dot);
				if (dot < 0 || !isPagerKey(id)) continue;
				const path = join(directory, file);
				try {
					if (file.endsWith(".ack")) {
						if (now - (await stat(path)).mtimeMs >= PAGE_TTL_MS) await unlinkIfPresent(path);
						continue;
					}
					if (!file.endsWith(".page")) continue;
					const page = await readPage(path, id, sessionId);
					// Pi rejects injections during compaction or branch summaries. Keep fresh pages until ready.
					if (page && !running && !ctx.isIdle()) continue;
					// An interruption can fail after Pi begins delivery. Do not replay it on retry or reload.
					await unlinkIfPresent(path);
					if (!page || closed || ctx.sessionManager.getSessionId() !== sessionId) continue;
					const shortId = page.fromSessionId.slice(0, 8);
					const sender = page.fromName ? `${page.fromName} · ${shortId}` : shortId;
					const text = `[Page from ${sender}] ${page.text}`;
					const idle = ctx.isIdle() && pending.size === 0;
					pending.set(page.id, { text, hop: page.hop, queuedAt: Date.now() });
					try {
						if (idle) pi.sendUserMessage(text);
						else pi.sendUserMessage(text, { deliverAs: "steer" });
					} catch (error) {
						pending.delete(page.id);
						throw error;
					}
					if (ctx.hasUI) ctx.ui.notify(`Page from ${sender}`, "info");
				} catch (error) {
					if (errorCode(error) !== "ENOENT") reportError(error);
				}
			}
		} catch (error) {
			reportError(error);
		} finally {
			draining = false;
		}
	};

	try {
		watcher = watch(directory, { persistent: false }, () => void drain());
		watcher.on("error", () => watcher?.close());
	} catch {
		// Poll even on filesystems without watch support.
	}
	const poll = setInterval(() => void drain(), POLL_MS);
	poll.unref();

	return {
		presence,
		nextHop: () => activeHop === undefined ? 0 : activeHop + 1,
		async acknowledge(text) {
			if (closed) return;
			for (const [id, page] of pending) {
				if (text !== page.text) continue;
				pending.delete(id);
				activeHop = Math.max(activeHop ?? 0, page.hop);
				try {
					await writeFile(join(directory, `${id}.ack`), "", { mode: 0o600, flag: "wx" });
				} catch (error) {
					reportError(error);
				}
				break;
			}
		},
		setRunning(value) { running = value; },
		settled() { activeHop = undefined; },
		async close(quitting) {
			closed = true;
			watcher?.close();
			clearInterval(poll);
			pending.clear();
			await rm(quitting ? processDirectory : directory, { recursive: true, force: true });
		},
	};
}
