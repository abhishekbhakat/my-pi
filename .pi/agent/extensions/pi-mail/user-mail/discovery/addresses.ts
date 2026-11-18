import { networkInterfaces } from "node:os";

export function broadcastAddresses(interfaces = networkInterfaces()): string[] {
	const addresses = new Set(["255.255.255.255"]);
	for (const entries of Object.values(interfaces)) {
		for (const entry of entries ?? []) {
			if (entry.family !== "IPv4" || entry.internal) continue;
			const mask = entry.netmask.split(".").map(Number);
			const broadcast = entry.address.split(".").map((octet, index) => Number(octet) | (255 ^ mask[index]!));
			addresses.add(broadcast.join("."));
		}
	}
	return [...addresses];
}
