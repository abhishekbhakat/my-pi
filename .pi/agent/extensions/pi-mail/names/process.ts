import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const exec = promisify(execFile);

export function isProcessId(pid: unknown): pid is number {
	return typeof pid === "number" && Number.isInteger(pid) && pid > 0 && pid <= 0x7fffffff;
}

export function pidIsGone(pid: number): boolean {
	if (!isProcessId(pid)) return false;
	try {
		process.kill(pid, 0);
		return false;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "ESRCH";
	}
}

// A missing result means the probe failed. Reserve that owner's name until we can check again.
type Starts = Map<number, string | null>;
let ownStart: string | undefined;

async function linuxStarts(pids: number[], result: Starts): Promise<void> {
	const bootId = (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim();
	await Promise.all(pids.map(async (pid) => {
		try {
			const stat = await readFile(`/proc/${pid}/stat`, "utf8");
			const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
			const ticks = fields[19]; // /proc stat field 22, after dropping pid and comm.
			if (/^[ZX]$/.test(fields[0] ?? "")) result.set(pid, null);
			else if (ticks && /^\d+$/.test(ticks)) result.set(pid, `${bootId}:${ticks}`);
		} catch {
			if (pidIsGone(pid)) result.set(pid, null);
		}
	}));
}

async function psStarts(pids: number[], result: Starts): Promise<void> {
	const { stdout } = await exec("ps", ["-o", "pid=", "-o", "stat=", "-o", "lstart=", "-p", pids.join(",")], {
		encoding: "utf8", timeout: 1000, env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
	});
	for (const line of stdout.split("\n")) {
		const row = /^\s*(\d+)\s+(\S+)\s+(.+?)\s*$/.exec(line);
		if (row) result.set(Number(row[1]), /^[ZX]/.test(row[2]!) ? null : row[3]!);
	}
}

async function windowsStarts(pids: number[], result: Starts): Promise<void> {
	const command = `Get-Process -Id @(${pids.join(",")}) -ErrorAction SilentlyContinue | ForEach-Object { try { "$($_.Id) $($_.StartTime.ToFileTimeUtc())" } catch {} }`;
	const { stdout } = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
		encoding: "utf8", timeout: 1500, windowsHide: true,
	});
	for (const line of stdout.split("\n")) {
		const row = /^(\d+) (\d+)\s*$/.exec(line);
		if (row) result.set(Number(row[1]), row[2]!);
	}
}

export async function readProcessStarts(pids: Iterable<number>): Promise<Starts> {
	const result: Starts = new Map();
	const candidates = [...new Set(pids)].filter((pid) => {
		if (pid === process.pid && ownStart) {
			result.set(pid, ownStart);
			return false;
		}
		if (!pidIsGone(pid)) return true;
		result.set(pid, null);
		return false;
	});
	if (candidates.length === 0) return result;
	try {
		if (process.platform === "linux") await linuxStarts(candidates, result);
		else if (process.platform === "win32") await windowsStarts(candidates, result);
		else await psStarts(candidates, result);
	} catch {
		// A probe failure does not prove that a process exited.
	}
	for (const pid of candidates) if (!result.has(pid) && pidIsGone(pid)) result.set(pid, null);
	ownStart ??= result.get(process.pid) ?? undefined;
	return result;
}
