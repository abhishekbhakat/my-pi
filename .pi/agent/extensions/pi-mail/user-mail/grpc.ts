import { fileURLToPath } from "node:url";
import type * as Grpc from "@grpc/grpc-js";
import type { MailEnvelope, PingResponse } from "./protocol.ts";

export type UserMailRpc = {
	Ping: [Record<string, never>, PingResponse];
	RegisterUser: [{ id: string }, { registered: boolean; id: string }];
	ResolveAlias: [{ alias: string }, { ids: string[] }];
	SendMail: [MailEnvelope, { queued: boolean; id: string }];
	FetchInbox: [{ id: string }, { messages: MailEnvelope[] }];
	ReadAck: [{ id: string; messageIds: string[] }, { archived: string[] }];
};

let transport: Promise<{ grpc: typeof Grpc; UserMail: Grpc.ServiceClientConstructor }> | undefined;

export function loadGrpc() {
	return transport ??= (async () => {
		const [grpc, loader] = await Promise.all([import("@grpc/grpc-js"), import("@grpc/proto-loader")]);
		const file = fileURLToPath(new URL("./proto/user_mail.proto", import.meta.url));
		const definition = await loader.load(file, { longs: Number, arrays: true });
		const namespace = grpc.loadPackageDefinition(definition).pi_user_mail as Grpc.GrpcObject;
		return { grpc, UserMail: namespace.UserMail as Grpc.ServiceClientConstructor };
	})();
}
