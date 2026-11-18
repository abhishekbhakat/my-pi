import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CompactBlock, blockPreview, blockText, compactToolRenderers } from "#compact-blocks";
import { Type } from "@sinclair/typebox";
import { readSessionNames } from "../names/registry.ts";
import {
	ackMail,
	getAgentDirPath,
	getMailDir,
	getMailTtlMs,
	isMailStale,
	listInbox,
	MAX_MAIL_CHARS,
	queueMail,
	resolveMailbox,
	type MailMessage,
} from "./mailbox.ts";

const MAX_LIST_LIMIT = 50;
const MAIL_CUSTOM_TYPE = "pi_mail_message";

function clampLimit(raw: number | undefined, fallback: number): number {
	const n = raw ?? fallback;
	if (!Number.isFinite(n) || n < 1) return fallback;
	return Math.min(Math.floor(n), MAX_LIST_LIMIT);
}

function formatAge(sentAt: number): string {
	const mins = Math.max(0, Math.round((Date.now() - sentAt) / 60000));
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.floor(hours / 24)}d ago`;
}

export function registerMail(pi: ExtensionAPI) {
	pi.registerMessageRenderer(MAIL_CUSTOM_TYPE, (message, options, theme) => {
		const full = blockText(message.content);
		return new CompactBlock({ name: "mail", summary: blockPreview(full), full }, theme, options.expanded);
	});
	pi.registerTool({
		name: "mail",
		label: "Mail",
		...compactToolRenderers("mail"),
		description:
			"Passive mailbox between pi sessions on this machine. send queues a message " +
			"into the target session mailbox (queued, never delivered to a background process). " +
			"inbox peeks unread headers. read injects unread mail into your own current " +
			"leaf as display-only entries and marks them read. sessions lists live session addresses. " +
			"Nothing ever triggers a turn.",
		promptSnippet: "Mailbox: run mail inbox when starting work and when idle; unread mail waits there.",
		promptGuidelines: [
			"Check mail inbox at the start of a work session and whenever you are blocked or idle.",
			"Reading mail never triggers the sender; reply with mail send if an answer is needed.",
		],
		parameters: Type.Object({
			action: Type.Union([Type.Literal("send"), Type.Literal("inbox"), Type.Literal("read"), Type.Literal("sessions")], {
				description: "send queues mail; inbox peeks headers; read injects bodies; sessions lists live addresses",
			}),
			to: Type.Optional(Type.String({ description: "Full session ID, unique short ID, or live name like dp1 (send only)" })),
			message: Type.Optional(Type.String({ description: "Message text (send only)" })),
			limit: Type.Optional(
				Type.Number({
					description: `Max entries for inbox/read/sessions (capped at ${MAX_LIST_LIMIT})`,
					minimum: 1,
					maximum: MAX_LIST_LIMIT,
				}),
			),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const agentDir = getAgentDirPath();
			const ownId = ctx.sessionManager.getSessionId();
			const ok = (text: string, details: Record<string, unknown> = {}) => ({
				content: [{ type: "text" as const, text }],
				details,
			});

			try {
				const names = await readSessionNames(getMailDir(agentDir));
				if (params.action === "sessions") {
					const sorted = [...names.values()].sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
					const found = sorted.slice(0, clampLimit(params.limit, MAX_LIST_LIMIT));
					if (found.length === 0) return ok("No live named sessions.", { total: 0 });
					const lines = found.map(({ name, shortId, id, cwd, pager }) => `${name} ${shortId} ${id} ${JSON.stringify(pager?.cwd ?? cwd)}`);
					return ok(lines.join("\n"), { total: sorted.length, shown: found.length });
				}
				if (params.action === "send") {
					if (!params.to?.trim() || !params.message?.trim()) {
						return ok("Error: send needs both to and message.", { error: "invalid_request" });
					}
					const target = await resolveMailbox(agentDir, params.to, names);
					if (target === ownId) {
						return ok("Error: cannot mail your own session.", { error: "self_target" });
					}
					const receipt = await queueMail(
						agentDir, target, ownId, params.message, pi.getSessionName(), names.get(ownId)?.name,
					);
					return ok(`Queued for ${names.get(target)?.name ?? target} (id ${receipt.id}). Passive: they read it when active.`, {
						queued: true, id: receipt.id, to: target,
					});
				}

				const ttlMs = getMailTtlMs();
				// A stored alias can be recycled. Only show a live alias that still belongs to the sender.
				const senderName = (message: MailMessage) => names.get(message.fromSessionId)?.name ?? message.fromName ?? message.fromSessionId;
				if (params.action === "inbox") {
					const msgs = await listInbox(agentDir, ownId);
					const limit = clampLimit(params.limit, 20);
					const stale = msgs.filter((m) => isMailStale(m, Date.now(), ttlMs)).length;
					if (msgs.length === 0) return ok("Inbox empty.", { unread: 0 });
					const lines = msgs.slice(0, limit).map(
						(m) => `• ${m.id.slice(0, 8)} from ${senderName(m)} (${formatAge(m.sentAt)}${isMailStale(m, Date.now(), ttlMs) ? ", STALE" : ""})`,
					);
					return ok(
						`${msgs.length} unread${stale ? ` (${stale} stale)` : ""}. Use mail read to inject bodies into your leaf.\n${lines.join("\n")}`,
						{ unread: msgs.length, stale },
					);
				}

				// Ack after injecting each display-only entry so a mid-batch failure cannot drop mail.
				// Cap the total body size in one read.
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
							content: `**Mail from ${senderName(m)}** (${formatAge(m.sentAt)}${staleFlag})\n\n${m.text}`,
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
