import { loadGrpc, type UserMailRpc } from "./grpc.ts";
import { parseEnvelope, parsePing, type MailEnvelope, type PingResponse } from "./protocol.ts";

export interface ServerEndpoint {
	host: string;
	port: number;
}

export function grpcAddress({ host, port }: ServerEndpoint): string {
	return `${host.includes(":") ? `[${host}]` : host}:${port}`;
}

class RpcError extends Error {
	constructor(action: string, detail: string, readonly transportFailure: boolean) {
		super(`user-mail ${action} failed: ${detail}`);
	}
}

export function isTransportFailure(error: unknown): boolean {
	return error instanceof RpcError && error.transportFailure;
}

async function call<K extends keyof UserMailRpc>(
	endpoint: ServerEndpoint,
	method: K,
	action: string,
	request: UserMailRpc[K][0],
	timeoutMs: number,
): Promise<UserMailRpc[K][1]> {
	const deadline = Date.now() + timeoutMs;
	const { grpc, UserMail } = await loadGrpc();
	const client = new UserMail(grpcAddress(endpoint), grpc.credentials.createInsecure(), {
		"grpc.enable_retries": 0,
	});
	try {
		const rpc = UserMail.service[method]!;
		return await new Promise((resolve, reject) => {
			client.makeUnaryRequest<UserMailRpc[K][0], UserMailRpc[K][1]>(
				rpc.path, rpc.requestSerialize, rpc.responseDeserialize, request, { deadline },
				(error, value) => {
					if (!error && value) return resolve(value);
					const retryable = error?.code === grpc.status.UNAVAILABLE || error?.code === grpc.status.DEADLINE_EXCEEDED;
					reject(new RpcError(action, error?.details || "empty_response", retryable));
				},
			);
		});
	} finally {
		client.close();
	}
}

/** Probe one endpoint. Null for unreachable or incompatible servers. */
export async function ping(endpoint: ServerEndpoint, timeoutMs = 500): Promise<PingResponse | null> {
	try {
		return parsePing(await call(endpoint, "Ping", "ping", {}, timeoutMs));
	} catch {
		return null;
	}
}

export async function registerUser(endpoint: ServerEndpoint, id: string, timeoutMs = 2000): Promise<void> {
	await call(endpoint, "RegisterUser", "register", { id }, timeoutMs);
}

export async function resolveAlias(endpoint: ServerEndpoint, alias: string, timeoutMs = 2000): Promise<string[]> {
	const { ids } = await call(endpoint, "ResolveAlias", "resolve-alias", { alias }, timeoutMs);
	return ids;
}

export async function sendMail(endpoint: ServerEndpoint, envelope: MailEnvelope, timeoutMs = 5000): Promise<void> {
	await call(endpoint, "SendMail", "send", envelope, timeoutMs);
}

export async function fetchInbox(endpoint: ServerEndpoint, id: string, timeoutMs = 5000): Promise<MailEnvelope[]> {
	const { messages } = await call(endpoint, "FetchInbox", "fetch-inbox", { id }, timeoutMs);
	return messages.map(parseEnvelope).filter((message) => message !== null);
}

export async function readAck(
	endpoint: ServerEndpoint,
	id: string,
	messageIds: string[],
	timeoutMs = 5000,
): Promise<void> {
	await call(endpoint, "ReadAck", "read-ack", { id, messageIds }, timeoutMs);
}
