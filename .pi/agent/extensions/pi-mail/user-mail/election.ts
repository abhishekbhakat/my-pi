/**
 * Join a remembered or discovered server before claiming the local port.
 * An owner yields to a reachable server with a lower mail ID.
 */
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { discoveryPort, MAX_MAIL_CHARS, SERVICE, tcpPort, VERSION, type PingResponse } from "./protocol.ts";
import { ping, type ServerEndpoint } from "./client.ts";
import { broadcastQuery, DISCOVERY_TIMEOUT_MS, type DiscoveryHandle, type PeerPing } from "./discovery/index.ts";
import type { RunningServer } from "./server/index.ts";
import { userMailId, type UserIdentity } from "./identity.ts";

export type Role = "none" | "client" | "server";

export interface ElectionResult {
	role: Role;
	endpoint: ServerEndpoint | null;
	serverId: string | null;
	server?: RunningServer;
	discovery?: DiscoveryHandle;
	claimError?: string;
}

export interface ElectionOptions {
	identity: UserIdentity;
	rootDir: string;
	/** True when PI_USER_MAIL_SERVER=never: join but never claim. */
	never?: boolean;
	onRoleChange?: (result: ElectionResult) => void;
	probe?: (endpoint: ServerEndpoint) => Promise<PingResponse | null>;
	query?: (timeoutMs: number) => Promise<PeerPing[]>;
	claim?: (selfId: string) => Promise<RunningServer>;
}

export function shouldYield(myId: string, rivalId: string): boolean {
	return myId > rivalId;
}

async function readRemembered(rootDir: string): Promise<ServerEndpoint | null> {
	try {
		const { host, port } = JSON.parse(await readFile(join(rootDir, "server.json"), "utf-8")) as Partial<ServerEndpoint>;
		if (typeof host === "string" && host && typeof port === "number" && Number.isInteger(port) && port > 0 && port <= 65535) {
			return { host, port };
		}
	} catch {
		// No remembered server yet.
	}
	return null;
}

async function writeRemembered(rootDir: string, endpoint: ServerEndpoint, id: string): Promise<void> {
	await mkdir(rootDir, { recursive: true, mode: 0o700 });
	const temp = join(rootDir, `.server-${randomUUID()}.tmp`);
	try {
		await writeFile(temp, JSON.stringify({ ...endpoint, id, lastSeenAt: Date.now() }, null, 2) + "\n", {
			mode: 0o600,
		});
		await rename(temp, join(rootDir, "server.json"));
	} finally {
		await unlink(temp).catch(() => {});
	}
}

export async function runElection(options: ElectionOptions): Promise<ElectionResult> {
	const probe = options.probe ?? ping;
	const query = options.query ?? broadcastQuery;
	const port = tcpPort();
	const local = { host: "127.0.0.1", port };
	const remember = (endpoint: ServerEndpoint, id: string) =>
		writeRemembered(options.rootDir, endpoint, id).catch(() => {});

	const joinIfReachable = async (endpoint: ServerEndpoint): Promise<ElectionResult | null> => {
		const reply = await probe(endpoint);
		return reply?.version === VERSION ? { role: "client", endpoint, serverId: reply.id } : null;
	};

	const remembered = await readRemembered(options.rootDir);
	if (remembered) {
		const result = await joinIfReachable(remembered);
		if (result) return result;
	}

	for (const { host, port: peerPort } of await query(DISCOVERY_TIMEOUT_MS)) {
		const endpoint = { host, port: peerPort };
		const result = await joinIfReachable(endpoint);
		if (result) {
			await remember(endpoint, result.serverId!);
			return result;
		}
	}

	const sameHost = await joinIfReachable(local);
	if (sameHost) return sameHost;
	if (options.never) return { role: "none", endpoint: null, serverId: null };

	const selfId = userMailId(options.identity);
	let server: RunningServer | undefined;
	try {
		server = options.claim
			? await options.claim(selfId)
			: await (await import("./server/index.ts")).startServer({ port, rootDir: options.rootDir, selfId });
		const result: ElectionResult = {
			role: "server", endpoint: { host: local.host, port: server.port }, serverId: selfId, server,
		};
		const { startResponder } = await import("./discovery/responder.ts");
		let yielding = false;
		result.discovery = await startResponder({
			port: discoveryPort(),
			ping: { service: SERVICE, version: VERSION, id: selfId, maxChars: MAX_MAIL_CHARS },
			tcpPort: server.port,
			onRival: (rival) => {
				if (yielding || result.role !== "server" || !shouldYield(selfId, rival.ping.id)) return;
				yielding = true;
				void (async () => {
					try {
						const endpoint = { host: rival.host, port: rival.port };
						const peer = await probe(endpoint);
						if (peer?.version !== VERSION || peer.id !== rival.ping.id || result.role !== "server") return;
						// Let other sessions on this machine find the winner without rediscovering it.
						await remember(endpoint, peer.id);
						if (result.role !== "server") return;
						const discovery = result.discovery;
						Object.assign(result, { role: "client", endpoint, serverId: peer.id, server: undefined, discovery: undefined });
						await Promise.all([discovery?.stop(), server?.stop()]);
						options.onRoleChange?.(result);
					} finally {
						yielding = false;
					}
				})().catch(() => {});
			},
		});
		return result;
	} catch (error) {
		await server?.stop();
		// Lost the local bind race: the winning process may have started by now.
		const late = await joinIfReachable(local);
		if (late) return late;
		const claimError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
		await appendFile(join(options.rootDir, "debug.log"), `${new Date().toISOString()} claim failed: ${claimError}\n`).catch(() => {});
		return { role: "none", endpoint: null, serverId: null, claimError };
	}
}
