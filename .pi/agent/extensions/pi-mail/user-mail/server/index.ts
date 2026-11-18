import { mkdir } from "node:fs/promises";
import { grpcAddress } from "../client.ts";
import { loadGrpc } from "../grpc.ts";
import { MAX_REQUEST_BYTES } from "../protocol.ts";
import { userMailHandlers } from "./routes.ts";

export interface ServerOptions {
	/** 0 lets the OS pick a port. */
	port: number;
	/** Default 0.0.0.0 so LAN peers can reach us. */
	hostname?: string;
	rootDir: string;
	selfId: string;
}

export interface RunningServer {
	port: number;
	stop(): Promise<void>;
}

export async function startServer(options: ServerOptions): Promise<RunningServer> {
	await mkdir(options.rootDir, { recursive: true, mode: 0o700 });
	const { grpc, UserMail } = await loadGrpc();
	const server = new grpc.Server({ "grpc.max_receive_message_length": MAX_REQUEST_BYTES });
	server.addService(UserMail.service, userMailHandlers(options.rootDir, options.selfId, grpc.status));

	const address = grpcAddress({ host: options.hostname ?? "0.0.0.0", port: options.port });
	const port = await new Promise<number>((resolve, reject) => {
		server.bindAsync(address, grpc.ServerCredentials.createInsecure(), (error, boundPort) => {
			if (error) {
				server.forceShutdown();
				reject(error);
			} else resolve(boundPort);
		});
	});
	let stopping: Promise<void> | undefined;
	return {
		port,
		stop() {
			return stopping ??= new Promise<void>((resolve) => server.tryShutdown(() => resolve()));
		},
	};
}
