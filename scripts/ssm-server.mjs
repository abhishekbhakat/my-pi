#!/usr/bin/env node
/**
 * Detached SSM daemon entry. Installed to ~/.pi/agent/bin/ssm-server
 *
 *   ssm-server        # start (binds 127.0.0.1:17300)
 *   ssm-server --stop # SIGTERM pid in ssm-server.pid
 */
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PIDFILE = join(homedir(), ".pi", "agent", "ssm-server.pid");
const args = process.argv.slice(2);

if (args.includes("--stop") || args.includes("stop")) {
	if (existsSync(PIDFILE)) {
		const pid = Number(readFileSync(PIDFILE, "utf8").trim());
		if (Number.isInteger(pid) && pid > 0) {
			try {
				process.kill(pid, "SIGTERM");
			} catch {
				// already gone
			}
		}
		try {
			unlinkSync(PIDFILE);
		} catch {
			// ignore
		}
	}
	process.exit(0);
}

const homeDaemon = join(homedir(), ".pi", "agent", "extensions", "webui", "ssm", "daemon.ts");
const repoDaemon = join(dirname(fileURLToPath(import.meta.url)), "..", ".pi", "agent", "extensions", "webui", "ssm", "daemon.ts");
const daemonTs = existsSync(homeDaemon) ? homeDaemon : repoDaemon;

if (!existsSync(daemonTs)) {
	console.error(`ssm-server: daemon.ts not found at ${daemonTs}`);
	process.exit(1);
}

function pkgIfPresent(dir) {
	return existsSync(join(dir, "package.json")) ? dir : null;
}

function findPiPackageDir() {
	if (process.env.PI_PACKAGE_DIR) {
		const envDir = pkgIfPresent(process.env.PI_PACKAGE_DIR);
		if (envDir) return envDir;
	}
	const bunGlobal = join(homedir(), ".bun", "install", "global", "node_modules", "@earendil-works", "pi-coding-agent");
	const bunHit = pkgIfPresent(bunGlobal);
	if (bunHit) return bunHit;
	try {
		const g = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
		const npmHit = pkgIfPresent(join(g, "@earendil-works", "pi-coding-agent"));
		if (npmHit) return npmHit;
	} catch {
		// ignore
	}
	const brew = pkgIfPresent("/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent");
	if (brew) return brew;
	throw new Error("cannot find @earendil-works/pi-coding-agent");
}

const piDir = findPiPackageDir();
const require = createRequire(join(piDir, "package.json"));
const jiti = require("jiti");
const load = jiti(daemonTs, {
	interopDefault: true,
	alias: {
		"@earendil-works/pi-coding-agent": join(piDir, "dist", "index.js"),
	},
});
load(daemonTs);
