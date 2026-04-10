import type { ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { ServerResponse } from "node:http";
import type { Server as HttpServer } from "node:http";

interface SessionManagerLike {
	getSessionFile(): string | undefined;
	getSessionId(): string;
	getSessionName(): string | undefined;
	getHeader(): unknown;
	getEntries(): unknown[];
	getLeafId(): string | null;
}

export interface WebUiClient {
	id: string;
	response: ServerResponse;
}

export interface ModelSnapshot {
	provider?: string;
	id?: string;
	name?: string;
}

export interface WebUiRuntime {
	httpServer?: HttpServer;
	clients: Map<string, WebUiClient>;
	port?: number;
	baseUrl?: string;
	cwd?: string;
	isStreaming: boolean;
	currentContext?: ExtensionContext | ExtensionCommandContext;
	currentSessionManager?: SessionManagerLike;
	currentSystemPrompt?: string;
	currentModel?: ModelSnapshot;
	abortCurrent?: () => void;
}
