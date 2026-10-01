/**
 * Client side of user-mail discovery (issue #5): broadcast a query on the
 * discovery port, collect server hellos until the timeout, close. Uses
 * node:dgram with setBroadcast rather than Bun.udpSocket.
 */

import dgram from "node:dgram";
import { discoveryPort } from "../protocol.ts";
import { peerFrom, wirePayload, type PeerHello } from "./peer.ts";

export function broadcastQuery(timeoutMs = 300, port = discoveryPort()): Promise<PeerHello[]> {
	return new Promise((resolve) => {
		const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
		const found = new Map<string, PeerHello>();
		let timer: ReturnType<typeof setTimeout> | undefined;
		const finish = () => {
			if (timer) clearTimeout(timer);
			try {
				socket.close();
			} catch {
				// Already closed by error path.
			}
			resolve([...found.values()]);
		};
		socket.on("message", (data, rinfo) => {
			const peer = peerFrom(data, rinfo.address);
			if (peer) found.set(`${peer.host}:${peer.hello.id}`, peer);
		});
		socket.on("error", finish);
		timer = setTimeout(finish, timeoutMs);
		socket.bind(() => {
			socket.setBroadcast(true);
			socket.send(wirePayload("query", "", port), port, "255.255.255.255");
		});
	});
}
