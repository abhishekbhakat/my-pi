import dgram from "node:dgram";
import type { PingResponse } from "../protocol.ts";
import { broadcastAddresses } from "./addresses.ts";
import { parseDiscovery, wirePayload, type PeerPing } from "./peer.ts";

export interface DiscoveryHandle {
	stop(): Promise<void>;
}

export interface ResponderOptions {
	port: number;
	ping: PingResponse;
	tcpPort: number;
	onRival?: (rival: PeerPing) => void;
	announceEveryMs?: number;
}

export async function startResponder(options: ResponderOptions): Promise<DiscoveryHandle> {
	const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
	const payload = wirePayload("announce", options.ping.id, options.tcpPort);
	const send = (port: number, address: string) => socket.send(payload, port, address, () => {});
	const announce = () => {
		for (const address of broadcastAddresses()) send(options.port, address);
	};
	socket.on("message", (data, rinfo) => {
		const packet = parseDiscovery(data, rinfo.address);
		if (packet?.kind === "query") send(rinfo.port, rinfo.address);
		else if (packet?.kind === "announce" && packet.peer.ping.id !== options.ping.id) {
			options.onRival?.(packet.peer);
		}
	});

	let timer: ReturnType<typeof setInterval> | undefined;
	let stopping: Promise<void> | undefined;
	function stop() {
		if (timer) clearInterval(timer);
		return stopping ??= new Promise<void>((resolve) => {
			try { socket.close(() => resolve()); } catch { resolve(); }
		});
	}

	try {
		await new Promise<void>((resolve, reject) => {
			socket.once("error", reject);
			socket.bind(options.port, () => {
				socket.removeListener("error", reject);
				socket.on("error", () => void stop());
				resolve();
			});
		});
		socket.setBroadcast(true);
		announce();
		timer = setInterval(announce, options.announceEveryMs ?? 30_000);
	} catch (error) {
		await stop();
		throw error;
	}
	return { stop };
}
