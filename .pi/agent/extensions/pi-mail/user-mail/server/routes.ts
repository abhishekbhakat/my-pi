import type { ServerUnaryCall, UntypedServiceImplementation, sendUnaryData } from "@grpc/grpc-js";
import { join } from "node:path";
import { badMailboxId, loadRegistry, saveRegistry } from "./registry.ts";
import { RateLimiter } from "./ratelimit.ts";
import { ackMessages, hasMessage, listUnread, unreadChars, writeMessage } from "../mailbox/store.ts";
import { isMessageId, MAX_MAIL_CHARS, parseEnvelope, SERVICE, VERSION } from "../protocol.ts";
import type { loadGrpc, UserMailRpc } from "../grpc.ts";

type Status = Awaited<ReturnType<typeof loadGrpc>>["grpc"]["status"];
type FailureStatus = "INVALID_ARGUMENT" | "NOT_FOUND" | "RESOURCE_EXHAUSTED" | "FAILED_PRECONDITION";

class Rejection extends Error {
	constructor(readonly status: FailureStatus, detail: string) {
		super(detail);
	}
}

function validMailbox(value: string | undefined): string {
	const id = value?.trim() ?? "";
	if (badMailboxId(id)) throw new Rejection("INVALID_ARGUMENT", "invalid_id");
	return id;
}

function sourceIp(peer: string): string {
	// getPeer() includes an ephemeral port, which must not factor into the limit.
	const address = peer.replace(/^ipv[46]:/, "").replace(/:\d+$/, "");
	return address.replace(/^\[|\]$/g, "").replace(/^::ffff:/, "") || "unknown";
}

export function userMailHandlers(rootDir: string, selfId: string, status: Status): UntypedServiceImplementation {
	const limiter = new RateLimiter();
	const inbox = (id: string) => join(rootDir, "inboxes", id);
	let writes = Promise.resolve();

	// Serialize read-modify-write operations in this server, including mailbox caps.
	function serial<T>(operation: () => Promise<T>): Promise<T> {
		const next = writes.then(operation);
		writes = next.then(() => {}, () => {});
		return next;
	}

	function handle<M extends keyof UserMailRpc>(
		_method: M,
		operation: (request: UserMailRpc[M][0], call: ServerUnaryCall<UserMailRpc[M][0], UserMailRpc[M][1]>) =>
			UserMailRpc[M][1] | Promise<UserMailRpc[M][1]>,
	) {
		return (call: ServerUnaryCall<UserMailRpc[M][0], UserMailRpc[M][1]>, done: sendUnaryData<UserMailRpc[M][1]>) => {
			void Promise.resolve().then(() => operation(call.request, call)).then(
				(value) => done(null, value),
				(error: unknown) => {
					if (error instanceof Rejection) done({ code: status[error.status], details: error.message });
					else done({ code: status.INTERNAL, details: "internal" });
				},
			);
		};
	}

	return {
		Ping: handle("Ping", () => ({ service: SERVICE, version: VERSION, id: selfId, maxChars: MAX_MAIL_CHARS })),
		RegisterUser: handle("RegisterUser", ({ id: raw }) => serial(async () => {
			const id = validMailbox(raw);
			const registry = await loadRegistry(rootDir);
			const now = Date.now();
			registry[id] = { registeredAt: registry[id]?.registeredAt ?? now, lastSeenAt: now };
			await saveRegistry(rootDir, registry);
			return { registered: true, id };
		})),
		ResolveAlias: handle("ResolveAlias", ({ alias: raw }) => {
			const alias = raw?.trim();
			if (!alias) throw new Rejection("INVALID_ARGUMENT", "invalid_alias");
			return loadRegistry(rootDir).then((registry) => ({
				ids: Object.keys(registry).filter((id) => id.startsWith(`${alias}@`)),
			}));
		}),
		SendMail: handle("SendMail", (request, call) => {
			if (!limiter.allow(sourceIp(call.getPeer()))) throw new Rejection("RESOURCE_EXHAUSTED", "rate_limited");
			const envelope = parseEnvelope(request);
			if (!envelope) throw new Rejection("INVALID_ARGUMENT", "invalid_envelope");
			if (badMailboxId(envelope.to)) throw new Rejection("INVALID_ARGUMENT", "invalid_recipient");
			return serial(async () => {
				const registry = await loadRegistry(rootDir);
				if (!Object.hasOwn(registry, envelope.to)) throw new Rejection("NOT_FOUND", "unknown_recipient");
				const folder = inbox(envelope.to);
				// A retry with the same ID must not resurrect an archived message.
				if (!await hasMessage(folder, envelope.id)) {
					if (await unreadChars(folder) + envelope.text.length > MAX_MAIL_CHARS) {
						throw new Rejection("FAILED_PRECONDITION", "mailbox_full");
					}
					await writeMessage(folder, envelope);
				}
				return { queued: true, id: envelope.id };
			});
		}),
		FetchInbox: handle("FetchInbox", async ({ id: raw }) => {
			const id = validMailbox(raw);
			const registry = await loadRegistry(rootDir);
			if (!Object.hasOwn(registry, id)) throw new Rejection("NOT_FOUND", "unknown_recipient");
			return { messages: await listUnread(inbox(id)) };
		}),
		ReadAck: handle("ReadAck", ({ id: raw, messageIds }) => serial(async () => {
			const id = validMailbox(raw);
			if (!messageIds?.length) throw new Rejection("INVALID_ARGUMENT", "no_message_ids");
			if (!messageIds.every(isMessageId)) throw new Rejection("INVALID_ARGUMENT", "invalid_message_id");
			return { archived: await ackMessages(inbox(id), messageIds) };
		})),
	};
}
