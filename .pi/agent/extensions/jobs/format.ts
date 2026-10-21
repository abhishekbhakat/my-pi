import type { JobState } from "./state.ts";

export const NOTIFY_TAIL_LINES = 20;
export const NOTIFY_TAIL_LINE_CHARS = 300;
export const NOTIFY_MAX_CHARS = 4000;

export interface ToolText {
	content: Array<{ type: "text"; text: string }>;
	details: Record<string, unknown>;
}

export function text(content: string, details?: Record<string, unknown>): ToolText {
	return { content: [{ type: "text", text: content }], details: details ?? {} };
}

export function formatElapsed(ms: number): string {
	const total = Math.max(0, Math.round(ms / 1000));
	if (total < 60) return `${total}s`;
	const minutes = Math.floor(total / 60);
	const seconds = total % 60;
	if (minutes < 60) return `${minutes}m${seconds.toString().padStart(2, "0")}s`;
	return `${Math.floor(minutes / 60)}h${(minutes % 60).toString().padStart(2, "0")}m`;
}

export function jobName(job: JobState): string {
	const raw = job.label ?? job.command;
	const flat = raw.replace(/\s+/g, " ").trim();
	return flat.length > 90 ? `${flat.slice(0, 89)}...` : flat;
}

export function jobLine(job: JobState): string {
	const elapsed = formatElapsed((job.endedAt ?? Date.now()) - job.startedAt);
	if (job.status === "running") return `${job.id} running ${elapsed} ${jobName(job)}`;
	const code = job.exitCode === undefined ? "?" : String(job.exitCode);
	return `${job.id} ${job.status} exit=${code} ${elapsed} ${jobName(job)}`;
}

export function renderJobs(jobs: readonly JobState[]): string {
	if (jobs.length === 0) return "No jobs.";
	return jobs.map(jobLine).join("\n");
}

/** Per-line cap keeps one huge line from eating the whole notification. */
export function clipTail(tail: string): string {
	return tail
		.split("\n")
		.map((line) => (line.length > NOTIFY_TAIL_LINE_CHARS ? `${line.slice(0, NOTIFY_TAIL_LINE_CHARS)}...` : line))
		.join("\n");
}

export function buildSettledContent(
	jobs: readonly JobState[],
	tails: ReadonlyMap<string, string>,
	running: readonly JobState[],
): string {
	const lines: string[] = [jobs.length === 1 ? "Job finished." : `${jobs.length} jobs finished.`, ""];
	for (const job of jobs) lines.push(jobLine(job));
	for (const job of jobs) {
		const tail = clipTail(tails.get(job.id) ?? "");
		if (tail.length === 0) continue;
		lines.push("", `${job.id} output (last ${NOTIFY_TAIL_LINES} lines):`, "```", tail, "```");
	}
	if (running.length > 0) {
		lines.push("", "Still running:", ...running.map((job) => `  ${jobLine(job)}`));
	}
	let content = lines.join("\n");
	if (content.length > NOTIFY_MAX_CHARS) {
		const cut = content.slice(0, NOTIFY_MAX_CHARS);
		const lastBreak = cut.lastIndexOf("\n");
		content = `${lastBreak > 0 ? cut.slice(0, lastBreak) : cut}\n... (truncated)`;
	}
	return content;
}
