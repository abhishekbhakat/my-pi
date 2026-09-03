import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "@sinclair/typebox";
import {
	ackMail,
	getAgentDirPath,
	getMailTtlMs,
	isMailStale,
	listInbox,
	MAX_MAIL_CHARS,
	queueMail,
	resolveMailbox,
} from "./mailbox.ts";

const MAX_LIST_LIMIT = 50;

function clampLimit(raw: number | undefined, fallback: number): number {
	const n = raw ?? fallback;
	if (!Number.isFinite(n) || n < 1) return fallback;
	return Math.min(Math.floor(n), MAX_LIST_LIMIT);
}

const MAIL_CUSTOM_TYPE = "pi_mail_message";

function formatAge(sentAt: number): string {
	const mins = Math.max(0, Math.round((Date.now() - sentAt) / 60000));
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.floor(hours / 24)}d ago`;
}

export default function piMailExtension(pi: ExtensionAPI) {
	pi.registerMessageRenderer(MAIL_CUSTOM_TYPE, (message, options, theme) => {
		const head = theme.fg("accent", "[mail] ");
		return new Text(head + String(message.content), options.outputPad, 0);
	});
	pi.registerTool({
		name: "mail",
		description:
			"Passive mailbox between pi sessions on this machine. send queues a message " +
			"into the target session mailbox (queued, never delivered to a background process). " +
			"inbox peeks unread headers. read injects unread mail into your own current " +
			"leaf as display-only entries and marks them read. Nothing ever triggers a turn.",
		promptSnippet: "Mailbox: run mail inbox when starting work and when idle; unread mail waits there.",
		promptGuidelines: [
			"Check mail inbox at the start of a work session and whenever you are blocked or idle.",
			"Reading mail never triggers the sender; reply with mail send if an answer is needed.",
		],
		parameters: Type.Object({
			action: Type.Union([Type.Literal("send"), Type.Literal("inbox"), Type.Literal("read")], {
				description: "send queues mail; inbox peeks headers; read injects bodies into your leaf",
			}),
			to: Type.Optional(Type.String({ description: "Target mailbox session id (send only)" })),
			message: Type.Optional(Type.String({ description: "Message text (send only)" })),
			limit: Type.Optional(
				Type.Number({
					description: `Max entries for inbox/read (capped at ${MAX_LIST_LIMIT})`,
					minimum: 1,
					maximum: MAX_LIST_LIMIT,
				}),
			),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const agentDir = getAgentDirPath();
			const ownId = ctx.sessionManager.getSessionId();
			const ttlMs = getMailTtlMs();
			const ok = (text: string, details: Record<string, unknown> = {}) => ({
				content: [{ type: "text" as const, text }],
				details,
			});

			try {
				if (params.action === "send") {
					if (!params.to?.trim() || !params.message?.trim()) {
						return ok("Error: send needs both to and message.", { error: "invalid_request" });
					}
					const target = await resolveMailbox(agentDir, params.to);
					if (target === ownId) {
						return ok("Error: cannot mail your own session.", { error: "self_target" });
					}
					const receipt = await queueMail(
						agentDir, target, ownId, params.message, pi.getSessionName(),
					);
					return ok(`Queued for ${target} (id ${receipt.id}). Passive: they read it when active.`, {
						queued: true, id: receipt.id, to: target,
					});
				}

				if (params.action === "inbox") {
					const msgs = await listInbox(agentDir, ownId);
					const limit = clampLimit(params.limit, 20);
					const stale = msgs.filter((m) => isMailStale(m, Date.now(), ttlMs)).length;
					if (msgs.length === 0) return ok("Inbox empty.", { unread: 0 });
					const lines = msgs.slice(0, limit).map(
						(m) => `• ${m.id.slice(0, 8)} from ${m.fromName ?? m.fromSessionId} (${formatAge(m.sentAt)}${isMailStale(m, Date.now(), ttlMs) ? ", STALE" : ""})`,
					);
					return ok(
						`${msgs.length} unread${stale ? ` (${stale} stale)` : ""}. Use mail read to inject bodies into your leaf.\n${lines.join("\n")}`,
						{ unread: msgs.length, stale },
					);
				}

				// read: inject-then-ack per message. Display-only custom entries,
			// no turn triggered. Ack each message right after its own inject so
			// a mid-batch throw redelivers (dup) instead of dropping (loss).
				// Stop once injected body chars hit MAX_MAIL_CHARS so one read cannot
			// dump an unbounded batch into the leaf.
				const msgs = await listInbox(agentDir, ownId);
				const limit = clampLimit(params.limit, 20);
				const batch = msgs.slice(0, limit);
				if (batch.length === 0) return ok("Inbox empty.", { unread: 0 });
				let read = 0;
				let chars = 0;
				let stoppedForSize = false;
				for (const m of batch) {
					if (chars > 0 && chars + m.text.length > MAX_MAIL_CHARS) {
						stoppedForSize = true;
						break;
					}
					const staleFlag = isMailStale(m, Date.now(), ttlMs) ? " (STALE: sent " + formatAge(m.sentAt) + ")" : "";
					pi.sendMessage(
						{
							customType: MAIL_CUSTOM_TYPE,
							content: `**Mail from ${m.fromName ?? m.fromSessionId}** (${formatAge(m.sentAt)}${staleFlag})\n\n${m.text}`,
							display: true,
							details: { from: m.fromSessionId, messageId: m.id, sentAt: m.sentAt },
						},
						{ deliverAs: "steer" },
					);
					await ackMail(agentDir, ownId, [m.id]);
					chars += m.text.length;
					read += 1;
				}
				const sizeNote = stoppedForSize
					? ` Stopped at ${MAX_MAIL_CHARS} chars; run mail read again for the rest.`
					: "";
				return ok(
					`Read ${read} message(s) into your leaf (display-only, no turn triggered).${sizeNote}`,
					{ read, chars, stoppedForSize },
				);
			} catch (error) {
				const text = error instanceof Error ? error.message : String(error);
				return ok(`Error: ${text}`, { error: "failed" });
			}
		},
	});
}
