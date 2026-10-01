/**
 * Read action for user mail (issue #5). Syncs, then injects unread bodies
 * into the caller's leaf through an inject callback (the pi wiring passes
 * sendMessage with deliverAs steer). Each message is acked locally right
 * after its own inject; the server ack is queued and flushed at the end.
 */

import type { ServerEndpoint } from "../client.ts";
import { ackMessages, listUnread } from "./store.ts";
import { MAX_MAIL_CHARS, isStale } from "../protocol.ts";
import { flushPendingAcks, mirrorDir, queuePendingAcks } from "./sync.ts";
import { syncPrep } from "./inbox.ts";
import { clampLimit, formatAge } from "../session/format.ts";

/** Display-only injection into the current leaf. */
export type Inject = (content: string, details: Record<string, unknown>) => Promise<void>;

export interface ReadOutcome {
	text: string;
	details: Record<string, unknown>;
}

export async function performRead(
	endpoint: ServerEndpoint,
	rootDir: string,
	myId: string,
	inject: Inject,
	limit: number | undefined,
): Promise<ReadOutcome> {
	const added = await syncPrep(endpoint, rootDir, myId);
	const mirror = mirrorDir(rootDir);
	const messages = await listUnread(mirror);
	const batch = messages.slice(0, clampLimit(limit, 20));
	if (batch.length === 0) {
		return { text: "Inbox empty.", details: { unread: 0, added } };
	}
	let read = 0;
	let chars = 0;
	let stoppedForSize = false;
	for (const m of batch) {
		if (chars > 0 && chars + m.text.length > MAX_MAIL_CHARS) {
			stoppedForSize = true;
			break;
		}
		const staleFlag = isStale(m.sentAt) ? ` (STALE: sent ${formatAge(m.sentAt)})` : "";
		await inject(
			`**User mail from ${m.from}** (${formatAge(m.sentAt)}${staleFlag})\n\n${m.text}`,
			{ from: m.from, messageId: m.id, sentAt: m.sentAt },
		);
		await ackMessages(mirror, [m.id]);
		await queuePendingAcks(rootDir, [m.id]);
		chars += m.text.length;
		read += 1;
	}
	await flushPendingAcks(endpoint, myId, rootDir).catch(() => {});
	const sizeNote = stoppedForSize
		? ` Stopped at ${MAX_MAIL_CHARS} chars; run user_mail read again for the rest.`
		: "";
	return {
		text: `Read ${read} message(s) into your leaf (display-only, no turn triggered).${sizeNote}`,
		details: { read, chars, stoppedForSize, added },
	};
}
