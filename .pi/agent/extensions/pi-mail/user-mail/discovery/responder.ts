/**
 * Server side of user-mail discovery (issue #5): answer client queries,
 * broadcast an announcement on an interval, and report rival servers
 * upward for the tiebreak. One socket does all three.
 */

import dgram from "node:dgram";
import type { HelloResponse } from "../protocol.ts";
import { peerFrom, wirePayload, type PeerHello } from "./peer.ts";

export interface DiscoveryHandle {
	stop(): Promise<void>;
	/** Broadcast an announcement right now. */
	announce(): void;
}

export interface ResponderOptions {
	/** UDP port to bind. */
	port: number;
	/** This machine's hello, sent in replies and announcements. */
	hello: HelloResponse;
	/** This machine's TCP server port, included in announcements. */
	tcpPort: number;
	/** Called when another server announces itself. */
	onRival?: (rival: PeerHello) => void;
	/** Announcement interval. Default 30 seconds. */
	announceEveryMs?: number;
}

export function startResponder(options: ResponderOptions): DiscoveryHandle {
	const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
	const announce = () => {
		try {
			socket.send(
				wirePayload("announce", options.hello.id, options.tcpPort),
				options.port,
				"255.255.255.255",
			);
		} catch {
			// Broadcast send failures are non-fatal; the next interval retries.
		}
	};
	socket.on("message", (data, rinfo) => {
		const peer = peerFrom(data, rinfo.address);
		if (!peer) return;
		let kind: unknown;
		try {
			kind = (JSON.parse(data.toString()) as Record<string, unknown>).kind;
		} catch {
			return;
		}
		if (kind === "query") {
			socket.send(wirePayload("announce", options.hello.id, options.tcpPort), rinfo.port, rinfo.address);
		} else if (kind === "announce" && peer.hello.id !== options.hello.id) {
			options.onRival?.(peer);
		}
	});
	socket.bind(options.port);

	const timer = setInterval(announce, options.announceEveryMs ?? 30_000);
	return {
		announce,
		stop(): Promise<void> {
			clearInterval(timer);
			return new Promise((resolve) => {
				try {
					socket.close(() => resolve());
				} catch {
					resolve();
				}
			});
		},
	};
}
