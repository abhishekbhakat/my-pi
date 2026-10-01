/**
 * Shared UDP peer parsing for user-mail discovery (issue #5).
 */

import { DEFAULT_TCP_PORT, parseHello, SERVICE, VERSION, type HelloResponse } from "../protocol.ts";

export interface PeerHello {
	hello: HelloResponse;
	/** Source address of the UDP packet. */
	host: string;
	/** TCP port of the peer's server. */
	port: number;
}

export function wirePayload(kind: "query" | "announce", id: string, port: number): string {
	return JSON.stringify({ service: SERVICE, version: VERSION, kind, id, port });
}

/** Parse a UDP datagram into a peer, or null when it is not ours. */
export function peerFrom(data: Buffer, address: string): PeerHello | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(data.toString());
	} catch {
		return null;
	}
	const hello = parseHello(parsed);
	if (!hello) return null;
	const extra = parsed as Record<string, unknown>;
	const port =
		typeof extra.port === "number" && Number.isSafeInteger(extra.port) ? extra.port : DEFAULT_TCP_PORT;
	return { hello, host: address, port };
}
