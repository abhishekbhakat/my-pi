/**
 * Server election for user mail (issue #5).
 *
 * Exactly one machine on the network runs the server. Election order:
 * remembered server.json host, UDP broadcast, localhost, then claim the
 * role. Testable: probe, query, and claim are injectable.
 */

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { discoveryPort, tcpPort, type HelloResponse } from "./protocol.ts";
import { hello as probe, type ServerEndpoint } from "./client.ts";
import { broadcastQuery, type DiscoveryHandle, type PeerHello } from "./discovery/index.ts";
import type { RunningServer } from "./server/index.ts";
import { userMailId, type UserIdentity } from "./identity.ts";

export type Role = "none" | "client" | "server";

export interface ElectionResult {
	role: Role;
	/** Server endpoint for client calls. Null only for role "none". */
	endpoint: ServerEndpoint | null;
	/** Mail id of the machine running the server. */
	serverId: string | null;
	/** Set when this machine won the claim; stop it on session shutdown. */
	server?: RunningServer;
	/** Discovery responder for the owned server. */
	discovery?: DiscoveryHandle;
	/** Why a claim attempt failed, when role is "none" after one. */
	claimError?: string;
}

export interface ElectionOptions {
	identity: UserIdentity;
	/** The machine's user-mail dir: server.json, inboxes/, registry. */
	rootDir: string;
	/** True when PI_USER_MAIL_SERVER=never: join but never claim. */
	never?: boolean;
	/** Injectable for tests. */
	probe?: (endpoint: ServerEndpoint) => Promise<HelloResponse | null>;
	query?: (timeoutMs: number) => Promise<PeerHello[]>;
	claim?: (selfId: string) => Promise<RunningServer>;
}

interface Remembered {
	host: string;
	port: number;
	id: string;
	lastSeenAt: number;
}

/** Lower mail id keeps the server role on a split brain. */
export function shouldYield(myId: string, rivalId: string): boolean {
	return myId > rivalId;
}

async function readRemembered(rootDir: string): Promise<Remembered | null> {
	try {
		const parsed = JSON.parse(await readFile(join(rootDir, "server.json"), "utf-8")) as Partial<Remembered>;
		if (
			typeof parsed.host === "string" &&
			typeof parsed.port === "number" &&
			typeof parsed.id === "string"
		) {
			return { host: parsed.host, port: parsed.port, id: parsed.id, lastSeenAt: parsed.lastSeenAt ?? 0 };
		}
	} catch {
		// No remembered server yet.
	}
	return null;
}

async function writeRemembered(rootDir: string, remembered: Remembered): Promise<void> {
	await mkdir(rootDir, { recursive: true, mode: 0o700 });
	await writeFile(join(rootDir, "server.json"), JSON.stringify(remembered, null, 2) + "\n", {
		mode: 0o600,
	});
}

export async function runElection(options: ElectionOptions): Promise<ElectionResult> {
	const probeFn = options.probe ?? probe;
	const queryFn = options.query ?? broadcastQuery;
	const port = tcpPort();
	const remember = (host: string, id: string, remotePort = port) =>
		writeRemembered(options.rootDir, { host, port: remotePort, id, lastSeenAt: Date.now() });

	// 1. Remembered server.
	const remembered = await readRemembered(options.rootDir);
	if (remembered) {
		const answer = await probeFn({ host: remembered.host, port: remembered.port });
		if (answer) {
			return { role: "client", endpoint: { host: remembered.host, port: remembered.port }, serverId: answer.id };
		}
	}

	// 2. UDP broadcast.
	const peers = await queryFn(300);
	for (const peer of peers) {
		const answer = await probeFn({ host: peer.host, port: peer.port });
		if (answer) {
			await remember(peer.host, answer.id, peer.port);
			return { role: "client", endpoint: { host: peer.host, port: peer.port }, serverId: answer.id };
		}
	}

	// 3. Localhost: another session on this machine may own the server.
	const local = await probeFn({ host: "127.0.0.1", port });
	if (local) {
		return { role: "client", endpoint: { host: "127.0.0.1", port }, serverId: local.id };
	}

	// 4. Nothing anywhere: claim the role, unless forbidden.
	if (options.never) {
		return { role: "none", endpoint: null, serverId: null };
	}
	const selfId = userMailId(options.identity);
	// Lazy import: client sessions never load server code.
	const claim =
		options.claim ??
		(async () => {
			const { startServer } = await import("./server/index.ts");
			return startServer({
				port,
				rootDir: options.rootDir,
				selfId,
			});
		});
	try {
		const server = await claim(selfId);
		const result: ElectionResult = {
			role: "server",
			endpoint: { host: "127.0.0.1", port: server.port },
			serverId: selfId,
			server,
		};
		// Lazy import: responder code is server-side only.
		const { startResponder } = await import("./discovery/responder.ts");
		result.discovery = startResponder({
			port: discoveryPort(),
			hello: { service: "pi-user-mail", version: 1, id: selfId, maxChars: 100_000 },
			tcpPort: server.port,
			onRival: (rival) => {
				void handleRival(result, rival);
			},
		});
		return result;
	} catch (error) {
		// Lost a bind race with a session on this machine: run as its client.
		const late = await probeFn({ host: "127.0.0.1", port });
		if (late) {
			return { role: "client", endpoint: { host: "127.0.0.1", port }, serverId: late.id };
		}
		const claimError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
		try {
			await appendFile(
				join(options.rootDir, "debug.log"),
				`${new Date().toISOString()} claim failed: ${claimError}\n`,
			);
		} catch {
			// Debug log is best effort; never mask the election result.
		}
		return { role: "none", endpoint: null, serverId: null, claimError };
	}
}

/** Stop our server and hand the role to the rival when we lose the tiebreak. */
async function handleRival(result: ElectionResult, rival: PeerHello): Promise<void> {
	if (!result.serverId || !shouldYield(result.serverId, rival.hello.id)) return;
	await result.discovery?.stop();
	await result.server?.stop();
	result.role = "client";
	result.endpoint = { host: rival.host, port: rival.port };
	result.serverId = rival.hello.id;
	result.server = undefined;
	result.discovery = undefined;
}
