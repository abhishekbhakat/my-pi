import { parsePing, SERVICE, VERSION, type PingResponse } from "../protocol.ts";

export interface PeerPing {
	ping: PingResponse;
	host: string;
	port: number;
}

export function wirePayload(kind: "query" | "announce", id: string, port: number): string {
	return JSON.stringify({ service: SERVICE, version: VERSION, kind, id, port });
}

type DiscoveryPacket = { kind: "query" } | { kind: "announce"; peer: PeerPing };

export function parseDiscovery(data: Buffer, address: string): DiscoveryPacket | null {
	try {
		const parsed: unknown = JSON.parse(data.toString());
		if (typeof parsed !== "object" || parsed === null) return null;
		const packet = parsed as Record<string, unknown>;
		if (packet.service !== SERVICE || packet.version !== VERSION) return null;
		if (packet.kind === "query") return { kind: "query" };
		if (packet.kind !== "announce") return null;
		const { port } = packet;
		const ping = parsePing(packet);
		if (!ping || typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) return null;
		return { kind: "announce", peer: { ping, host: address, port } };
	} catch {
		return null;
	}
}
