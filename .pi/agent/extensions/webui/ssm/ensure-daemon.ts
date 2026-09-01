import { spawn } from "node:child_process";
import { existsSync, openSync } from "node:fs";
import { getPackageDir } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { join } from "node:path";
import { SSM_DAEMON_KIND, SSM_DAEMON_VERSION, SSM_ORIGIN } from "./constants";

export interface DaemonHealth {
	ok?: boolean;
	kind?: string;
	version?: string;
	pid?: number;
}

async function fetchHealth(): Promise<DaemonHealth | undefined> {
	try {
		const res = await fetch(`${SSM_ORIGIN}/api/health`, {
			signal: AbortSignal.timeout(1000),
		});
		if (!res.ok) return undefined;
		return (await res.json()) as DaemonHealth;
	} catch {
		return undefined;
	}
}

function binPath(): string {
	return join(homedir(), ".pi", "agent", "bin", "ssm-server");
}

function logPath(): string {
	return join(homedir(), ".pi", "agent", "ssm-server.log");
}

function nodeModulesRoot(): string {
	try {
		return join(getPackageDir(), "..", "..");
	} catch {
		return "";
	}
}

function spawnDaemon(): void {
	const bin = binPath();
	if (!existsSync(bin)) {
		throw new Error(`ssm-server missing at ${bin} — run make install`);
	}
	let packageDir = "";
	try {
		packageDir = getPackageDir();
	} catch {
		packageDir = "";
	}
	const log = openSync(logPath(), "a");
	const child = spawn(bin, [], {
		detached: true,
		stdio: ["ignore", log, log],
		env: {
			...process.env,
			NODE_PATH: [nodeModulesRoot(), process.env.NODE_PATH].filter(Boolean).join(":"),
			PI_PACKAGE_DIR: packageDir || process.env.PI_PACKAGE_DIR || "",
		},
	});
	child.unref();
}

function stopDaemon(): void {
	const bin = binPath();
	if (!existsSync(bin)) return;
	spawn(bin, ["--stop"], { stdio: "ignore" }).unref();
}

async function portFree(): Promise<boolean> {
	try {
		const res = await fetch(`${SSM_ORIGIN}/api/health`, { signal: AbortSignal.timeout(300) });
		return !res.ok;
	} catch {
		return true;
	}
}

async function waitPortFree(tries = 25): Promise<void> {
	for (let i = 0; i < tries; i++) {
		if (await portFree()) return;
		await new Promise((r) => setTimeout(r, 200));
	}
}

async function waitHealth(tries = 40): Promise<DaemonHealth | undefined> {
	for (let i = 0; i < tries; i++) {
		const health = await fetchHealth();
		if (health?.ok && health.kind === SSM_DAEMON_KIND) return health;
		await new Promise((r) => setTimeout(r, 200));
	}
	return fetchHealth();
}

/**
 * Ensure a fresh ssm-daemon on 17300: stop whatever is running, start anew.
 * Used by `/ssm-restart` and by ensure when dead or version-mismatched.
 */
export async function restartSsmDaemon(): Promise<DaemonHealth> {
	stopDaemon();
	await waitPortFree();
	spawnDaemon();
	const up = await waitHealth();
	if (!up?.ok || up.kind !== SSM_DAEMON_KIND) {
		throw new Error(
			`ssm-daemon did not start on 17300. See ${logPath()} or run: ~/.pi/agent/bin/ssm-server`,
		);
	}
	return up;
}

/** Non-disruptive: restart only when dead or version-mismatched. */
export async function ensureSsmDaemon(): Promise<DaemonHealth> {
	const health = await fetchHealth();
	if (health?.ok && health.kind === SSM_DAEMON_KIND && health.version === SSM_DAEMON_VERSION) {
		return health;
	}
	return restartSsmDaemon();
}
