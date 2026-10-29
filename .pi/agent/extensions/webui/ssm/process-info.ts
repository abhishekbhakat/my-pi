import { execFileSync } from "node:child_process";

export interface ProcessInfo { startedAt?: number; parentPid?: number }

export function parseProcessInfo(output: string): ProcessInfo {
	const match = output.trim().match(/^(\d+)\s+(.+)$/);
	if (!match) return {};
	const startedAt = Date.parse(match[2]);
	return { parentPid: Number(match[1]), startedAt: Number.isFinite(startedAt) ? startedAt : undefined };
}

/** Once per backend registration, never once per request or heartbeat. */
export function readProcessInfo(pid: number): ProcessInfo {
	try {
		return parseProcessInfo(execFileSync("ps", ["-p", String(pid), "-o", "ppid=,lstart="], {
			encoding: "utf8", timeout: 1000, env: { ...process.env, LC_ALL: "C" }, stdio: ["ignore", "pipe", "ignore"],
		}));
	} catch {
		return {};
	}
}
