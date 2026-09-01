/**
 * Find running `pi` processes and map them onto session files via cwd.
 * Does not depend on extension registration (Herdr panes that never /reload).
 */
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SsmLiveInfo } from "./routes";

function sessionDirForCwd(cwd: string): string {
	const trimmed = cwd.replace(/^\/+/, "").replace(/\//g, "-");
	return join(homedir(), ".pi", "agent", "sessions", `--${trimmed}--`);
}

function listPiPids(): number[] {
	let out = "";
	try {
		out = execFileSync("ps", ["-ax", "-o", "pid=,comm="], {
			encoding: "utf8",
			timeout: 2000,
		});
	} catch {
		return [];
	}
	const pids: number[] = [];
	for (const line of out.split("\n")) {
		const match = line.trim().match(/^(\d+)\s+(\S+)/);
		if (!match) continue;
		if (match[2] === "pi") pids.push(Number(match[1]));
	}
	return pids;
}

function cwdOfPids(pids: number[]): Map<number, string> {
	const map = new Map<number, string>();
	if (pids.length === 0) return map;
	let out = "";
	try {
		out = execFileSync("lsof", ["-Fn", "-a", "-d", "cwd", "-p", pids.join(",")], {
			encoding: "utf8",
			timeout: 3000,
		});
	} catch {
		return map;
	}
	let pid = 0;
	for (const line of out.split("\n")) {
		if (line.startsWith("p")) pid = Number(line.slice(1));
		else if (line.startsWith("n") && pid) map.set(pid, line.slice(1));
	}
	return map;
}

function newestJsonl(dir: string, count: number): string[] {
	let names: string[] = [];
	try {
		names = readdirSync(dir).filter((n) => n.endsWith(".jsonl"));
	} catch {
		return [];
	}
	names.sort().reverse();
	return names.slice(0, Math.max(0, count)).map((n) => join(dir, n));
}

function idFromPath(path: string): string | undefined {
	const base = path.split("/").pop() ?? "";
	const under = base.lastIndexOf("_");
	if (under < 0) return undefined;
	return base.slice(under + 1).replace(/\.jsonl$/, "");
}

/** Running pi processes → likely current session files (newest jsonl per cwd). */
export function discoverRunningSessions(): SsmLiveInfo[] {
	const pids = listPiPids();
	const cwds = cwdOfPids(pids);
	const byCwd = new Map<string, number[]>();
	for (const [pid, cwd] of cwds) {
		if (!cwd) continue;
		const list = byCwd.get(cwd);
		if (list) list.push(pid);
		else byCwd.set(cwd, [pid]);
	}

	const found: SsmLiveInfo[] = [];
	for (const [cwd, cwdPids] of byCwd) {
		const files = newestJsonl(sessionDirForCwd(cwd), cwdPids.length);
		for (let i = 0; i < files.length; i++) {
			found.push({
				pid: cwdPids[i],
				cwd,
				path: files[i],
				id: idFromPath(files[i]),
			});
		}
	}
	return found;
}
