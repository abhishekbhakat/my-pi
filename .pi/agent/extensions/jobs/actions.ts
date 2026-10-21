import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { jobLine, renderJobs, text, type ToolText } from "./format.ts";
import { checkSpawnCommand } from "./guard.ts";
import { spawnJob, terminateJob, waitForExit } from "./runner.ts";
import {
	jobPaths,
	listJobs,
	nextJobId,
	pidOwner,
	readExitCode,
	reconcile,
	tailLog,
	writeJob,
	type JobState,
} from "./state.ts";

const MAX_RUNNING = 16;
const OUTPUT_DEFAULT_LINES = 40;
const OUTPUT_MAX_LINES = 200;

export interface ActionDeps {
	updateStatus(jobs: readonly JobState[]): void;
	scan(): void;
}

/** Serializes id reservation so two spawns cannot claim the same j-number. */
let spawnChain: Promise<unknown> = Promise.resolve();

function withSpawnLock<T>(work: () => Promise<T>): Promise<T> {
	const result = spawnChain.then(work, work);
	spawnChain = result.then(
		() => undefined,
		() => undefined,
	);
	return result;
}

export async function spawnAction(
	root: string,
	ctx: ExtensionContext,
	params: { command?: string; label?: string },
	signal: AbortSignal | undefined,
	deps: ActionDeps,
): Promise<ToolText> {
	const command = (params.command ?? "").trim();
	if (command.length === 0) throw new Error("spawn needs a command.");
	const violation = checkSpawnCommand(command);
	if (violation) throw new Error(violation);

	return withSpawnLock(async () => {
		const jobs = await listJobs(root);
		const running = jobs.filter((job) => job.status === "running");
		if (running.length >= MAX_RUNNING) {
			throw new Error(`${MAX_RUNNING} jobs already running. Stop one first.\n${renderJobs(running)}`);
		}
		const id = nextJobId(jobs);
		const paths = jobPaths(root, id);
		let spawned;
		try {
			spawned = spawnJob(root, id, command, ctx.cwd);
		} catch (error) {
			throw new Error(`could not start ${id}: ${error instanceof Error ? error.message : String(error)}`);
		}
		if (spawned.pid === undefined) {
			throw new Error(`could not start ${id}: no pid`);
		}
		const job: JobState = {
			v: 1,
			id,
			label: params.label,
			command,
			cwd: ctx.cwd,
			pid: spawned.pid,
			startedAt: Date.now(),
			status: "running",
			notified: false,
		};
		await writeJob(root, job);
		deps.updateStatus([...jobs, job]);

		// Print and json modes have no idle wake, so block on the real exit instead of a timer.
		if (ctx.mode === "print" || ctx.mode === "json") {
			await waitForExit(() => readExitCode(paths.exit), signal);
			if (signal?.aborted) {
				await terminateJob(spawned.pid, () => readExitCode(paths.exit));
			}
			const done = (await reconcile(root)).all.find((item) => item.id === id);
			if (done) await writeJob(root, { ...done, notified: true });
			const tail = await tailLog(paths.log, OUTPUT_DEFAULT_LINES);
			const head = done ? jobLine(done) : `${id} unknown (exit file missing)`;
			return text([head, tail.length > 0 ? "```\n" + tail + "\n```" : "(no output)"].join("\n\n"), {
				id,
				exitCode: done?.exitCode,
			});
		}

		spawned.child.once("exit", () => {
			deps.scan();
		});
		return text(
			`${id} started pid=${spawned.pid}\nlog: ${paths.log}\n\nExit wakes you with the code and output. Keep working or end the turn.`,
			{ id, pid: spawned.pid, log: paths.log },
		);
	});
}

export async function listAction(root: string, deps: ActionDeps): Promise<ToolText> {
	const { all } = await reconcile(root);
	deps.updateStatus(all);
	return text(renderJobs(all), { count: all.length });
}

export async function outputAction(root: string, params: { id?: string; lines?: number }): Promise<ToolText> {
	const id = (params.id ?? "").trim();
	if (id.length === 0) throw new Error("output needs a job id.");
	const { all } = await reconcile(root);
	const job = all.find((item) => item.id === id);
	if (!job) throw new Error(`no job ${id}.`);
	const raw = params.lines ?? OUTPUT_DEFAULT_LINES;
	const lines = Math.min(
		OUTPUT_MAX_LINES,
		Math.max(1, Math.floor(Number.isFinite(raw) ? raw : OUTPUT_DEFAULT_LINES)),
	);
	const paths = jobPaths(root, id);
	const tail = await tailLog(paths.log, lines);
	const body = tail.length > 0 ? tail : "(no output)";
	return text([jobLine(job), `log: ${paths.log}`, "```", body, "```"].join("\n"), { id, status: job.status });
}

export async function stopAction(
	root: string,
	params: { id?: string },
	deps: ActionDeps,
): Promise<ToolText> {
	const id = (params.id ?? "").trim();
	if (id.length === 0) throw new Error("stop needs a job id.");
	const { all } = await reconcile(root);
	const job = all.find((item) => item.id === id);
	if (!job) throw new Error(`no job ${id}.`);
	if (job.status !== "running") {
		return text(`${jobLine(job)}\nAlready finished. Nothing to stop.`);
	}
	// Never signal a pid that now belongs to another program.
	const owner = await pidOwner(job.pid);
	if (owner !== "ours") {
		const lost: JobState = { ...job, status: "lost", endedAt: Date.now(), notified: true };
		await writeJob(root, lost);
		deps.updateStatus(all.map((item) => (item.id === id ? lost : item)));
		return text(`${jobLine(lost)}\nPid ${job.pid} is not this job anymore. Marked lost, nothing killed.`);
	}
	await writeJob(root, { ...job, stopRequested: true, notified: true });
	const paths = jobPaths(root, id);
	const result = await terminateJob(job.pid, () => readExitCode(paths.exit));
	const final: JobState = {
		...job,
		stopRequested: true,
		notified: true,
		status: "stopped",
		exitCode: result.code,
		endedAt: Date.now(),
	};
	await writeJob(root, final);
	deps.updateStatus(all.map((item) => (item.id === id ? final : item)));
	return text(`${jobLine(final)}\n${result.forced ? "SIGKILL after 5s grace." : "Stopped."}`, {
		id,
		exitCode: final.exitCode,
	});
}

export { OUTPUT_DEFAULT_LINES, OUTPUT_MAX_LINES, MAX_RUNNING };
