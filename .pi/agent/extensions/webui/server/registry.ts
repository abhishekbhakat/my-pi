import type { Server as HttpServer } from "node:http";

const REGISTRY_KEY = Symbol.for("pi.webui.httpServer");

export interface WebUiRegistryEntry {
	server: HttpServer;
	port: number;
	baseUrl: string;
	pid: number;
	startedAt: string;
	/** Close SSE clients + server. Bound by the owning module instance. */
	shutdown: () => Promise<void>;
}

interface GlobalRegistry {
	[REGISTRY_KEY]?: WebUiRegistryEntry;
	[key: symbol]: unknown;
}

function registry(): GlobalRegistry {
	return globalThis as unknown as GlobalRegistry;
}

export function getWebUiRegistryEntry(): WebUiRegistryEntry | undefined {
	return registry()[REGISTRY_KEY];
}

export function setWebUiRegistryEntry(entry: WebUiRegistryEntry | undefined): void {
	if (entry) registry()[REGISTRY_KEY] = entry;
	else delete registry()[REGISTRY_KEY];
}

/** Close whatever webui server this process registered, if any. */
export async function shutdownRegisteredWebUiServer(): Promise<boolean> {
	const entry = getWebUiRegistryEntry();
	if (!entry) return false;
	try {
		await entry.shutdown();
	} catch {
		// Best-effort clean.
	}
	if (getWebUiRegistryEntry()?.server === entry.server) {
		setWebUiRegistryEntry(undefined);
	}
	return true;
}
