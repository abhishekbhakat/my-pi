import dgram from "node:dgram";
import { discoveryPort } from "../protocol.ts";
import { broadcastAddresses } from "./addresses.ts";
import { parseDiscovery, wirePayload, type PeerPing } from "./peer.ts";

export const DISCOVERY_TIMEOUT_MS = 1_500;

export function broadcastQuery(timeoutMs = DISCOVERY_TIMEOUT_MS, port = discoveryPort()): Promise<PeerPing[]> {
	return new Promise((resolve) => {
		const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
		const found = new Map<string, PeerPing>();
		const timers: ReturnType<typeof setTimeout>[] = [];
		let closed = false;
		const finish = () => {
			if (closed) return;
			closed = true;
			for (const timer of timers) clearTimeout(timer);
			try { socket.close(); } catch { /* Already closed. */ }
			resolve([...found.values()]);
		};
		socket.on("message", (data, rinfo) => {
			const packet = parseDiscovery(data, rinfo.address);
			if (packet?.kind !== "announce") return;
			const { peer } = packet;
			found.set(`${peer.host}:${peer.port}`, peer);
		});
		socket.on("error", finish);
		timers.push(setTimeout(finish, timeoutMs));
		socket.bind(() => {
			if (closed) return;
			try {
				socket.setBroadcast(true);
			} catch {
				finish();
				return;
			}
			const payload = wirePayload("query", "", port);
			const destinations = broadcastAddresses();
			const send = () => {
				for (const address of destinations) socket.send(payload, port, address, () => {});
			};
			send();
			timers.push(setTimeout(send, timeoutMs / 3), setTimeout(send, 2 * timeoutMs / 3));
		});
	});
}
