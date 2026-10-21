import { execFile } from "node:child_process";
import { mkdir, open, readdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Lifecycle of a spawned job. "lost" means the pid vanished or no longer belongs to us. */
export type JobStatus = "running" | "exited" | "stopped" | "lost";

export interface JobState {
	v: 1;
	id: string;
	label?: string;
	command: string;
	cwd: string;
	pid: number;
	startedAt: number;
	status: JobStatus;
	exitCode?: number;
	endedAt?: number;
	notified?: boolean;
	stopRequested?: boolean;
}

export interface JobPaths {
	root: string;
	json: string;
	log: string;
	exit: string;
}

export const PRUNE_AGE_MS = 24 * 60 * 60 * 1000;

export function safeName(value: string): string {
	if (/^\.+$/.test(value)) return "session";
	const cleaned = value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
	return cleaned.length > 0 ? cleaned : "session";
}

export function jobsRoot(sessionId: string, base: string = tmpdir()): string {
	return join(base, "pi-jobs", safeName(sessionId));
}

export function jobPaths(root: string, id: string): JobPaths {
	return {
		root,
		json: join(root, `${id}.json`),
		log: join(root, `${id}.log`),
		exit: join(root, `${id}.exit`),
	};
}

export async function ensureRoot(root: string): Promise<void> {
	await mkdir(root, { recursive: true, mode: 0o700 });
}

export async function writeJob(root: string, job: JobState): Promise<void> {
	const paths = jobPaths(root, job.id);
	const tmp = `${paths.json}.tmp`;
	await writeFile(tmp, JSON.stringify(job), "utf8");
	await rename(tmp, paths.json);
}

export async function readJob(root: string, id: string): Promise<JobState | undefined> {
	try {
		const raw = await readFile(jobPaths(root, id).json, "utf8");
		const parsed = JSON.parse(raw) as JobState;
		return parsed && typeof parsed.id === "string" ? parsed : undefined;
	} catch {
		return undefined;
	}
}

export async function listJobs(root: string): Promise<JobState[]> {
	let names: string[];
	try {
		names = await readdir(root);
	} catch {
		return [];
	}
	const jobs: JobState[] = [];
	for (const name of names) {
		if (!name.endsWith(".json")) continue;
		const job = await readJob(root, name.slice(0, -".json".length));
		if (job) jobs.push(job);
	}
	jobs.sort((a, b) => jobNumber(a.id) - jobNumber(b.id));
	return jobs;
}

export function jobNumber(id: string): number {
	const n = Number(id.replace(/^j/, ""));
	return Number.isFinite(n) ? n : 0;
}

export function nextJobId(jobs: readonly JobState[]): string {
	let max = 0;
	for (const job of jobs) max = Math.max(max, jobNumber(job.id));
	return `j${max + 1}`;
}

export async function readExitCode(exitPath: string): Promise<number | undefined> {	try {
		const raw = (await readFile(exitPath, "utf8")).trim();
		const code = Number(raw);
		return Number.isInteger(code) ? code : undefined;
	} catch {
		return undefined;
	}
}

/** Flip the notified flag without clobbering a concurrent status change. */
export async function markNotified(root: string, id: string): Promise<void> {
	const fresh = await readJob(root, id);
	if (!fresh) return;
	await writeJob(root, { ...fresh, notified: true });
}

export function pidAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 1) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException)?.code === "EPERM";
	}
}

export type PidOwner = "ours" | "foreign" | "gone";

/**
 * A recycled pid must never be waited on or killed. The wrapper runs with `pijob`
 * as its argv[0], so a pid that no longer carries it is not our job.
 */
export async function pidOwner(pid: number): Promise<PidOwner> {
	if (!pidAlive(pid)) return "gone";
	try {
		const { stdout } = await run("ps", ["-o", "command=", "-p", String(pid)], {
			encoding: "utf8",
			timeout: 2000,
		});
		if (stdout.trim().length === 0) return "gone";
		return /\bpijob\b/.test(stdout) ? "ours" : "foreign";
	} catch {
		return "gone";
	}
}

export interface Reconciled {
	changed: JobState[];
	all: JobState[];
}

/** Bring running jobs in line with the exit file, pid liveness, and pid ownership. */
export async function reconcile(root: string): Promise<Reconciled> {
	const all = await listJobs(root);
	const changed: JobState[] = [];
	for (const job of all) {
		if (job.status !== "running") continue;
		const paths = jobPaths(root, job.id);
		const code = await readExitCode(paths.exit);
		if (code !== undefined) {
			const updated = await mergeWrite(root, job, {
				status: job.stopRequested ? "stopped" : "exited",
				exitCode: code,
				endedAt: await fileMtime(paths.exit),
			});
			changed.push(updated);
			continue;
		}
		const owner = await pidOwner(job.pid);
		if (owner !== "ours") {
			const updated = await mergeWrite(root, job, { status: "lost", endedAt: Date.now() });
			changed.push(updated);
		}
	}
	return { changed, all };
}

/** Re-read before writing so a concurrent stopRequested/notified is not clobbered. */
async function mergeWrite(root: string, job: JobState, patch: Partial<JobState>): Promise<JobState> {
	const fresh = (await readJob(root, job.id)) ?? job;
	const merged: JobState = { ...fresh, ...patch, id: job.id };
	await writeJob(root, merged);
	return merged;
}

async function fileMtime(path: string): Promise<number | undefined> {
	try {
		const info = await stat(path);
		return info.mtimeMs;
	} catch {
		return undefined;
	}
}

export async function logSize(logPath: string): Promise<number> {
	try {
		return (await stat(logPath)).size;
	} catch {
		return 0;
	}
}

/** Tail of the log. Reads only the last `maxBytes`, never the whole file. */
export async function tailLog(logPath: string, lines: number, maxBytes = 64 * 1024): Promise<string> {
	let handle;
	try {
		handle = await open(logPath, "r");
	} catch {
		return "";
	}
	try {
		const info = await handle.stat();
		if (info.size === 0) return "";
		const start = Math.max(0, info.size - maxBytes);
		const length = info.size - start;
		const buffer = Buffer.alloc(length);
		await handle.read(buffer, 0, length, start);
		const content = buffer.toString("utf8");
		const trimmed = content.endsWith("\n") ? content.slice(0, -1) : content;
		const all = trimmed.split("\n");
		return all.slice(Math.max(0, all.length - lines)).join("\n");
	} finally {
		await handle.close();
	}
}

export async function pruneJobs(root: string, now = Date.now()): Promise<number> {
	const jobs = await listJobs(root);
	let removed = 0;
	for (const job of jobs) {
		if (job.status === "running") continue;
		const ended = job.endedAt ?? job.startedAt;
		if (now - ended < PRUNE_AGE_MS) continue;
		const paths = jobPaths(root, job.id);
		for (const path of [paths.json, paths.log, paths.exit]) {
			try {
				await unlink(path);
			} catch {
				// Already gone.
			}
		}
		removed++;
	}
	return removed;
}

/** Remove whole session dirs that have not been touched in a day. */
export async function pruneSessionRoots(base: string = tmpdir(), now = Date.now()): Promise<number> {
	const parent = join(base, "pi-jobs");
	let names: string[];
	try {
		names = await readdir(parent);
	} catch {
		return 0;
	}
	let removed = 0;
	for (const name of names) {
		const dir = join(parent, name);
		try {
			const info = await stat(dir);
			if (!info.isDirectory()) continue;
			if (now - info.mtimeMs < PRUNE_AGE_MS) continue;
			// A job that outlives the prune window still owns its state.
			const jobs = await listJobs(dir);
			if (jobs.some((job) => job.status === "running")) continue;
			await rm(dir, { recursive: true, force: true });
			removed++;
		} catch {
			// Skip.
		}
	}
	return removed;
}
