/**
 * Send action for user mail (issue #5). Resolves the target, builds the
 * envelope, posts it to the network server.
 */

import { randomUUID } from "node:crypto";
import { resolveAlias, sendMail, type ServerEndpoint } from "../client.ts";

/** Bare alias to full mail id, with ambiguity rejection. */
async function resolveTarget(endpoint: ServerEndpoint, alias: string): Promise<string> {
	const ids = await resolveAlias(endpoint, alias);
	if (ids.length === 0) {
		throw new Error(`unknown peer ${JSON.stringify(alias)} on the server`);
	}
	if (ids.length > 1) {
		throw new Error(
			`ambiguous alias ${JSON.stringify(alias)}: ${ids.join(", ")}. Use the full alias@username.`,
		);
	}
	return ids[0]!;
}

export interface SendOutcome {
	text: string;
	details: Record<string, unknown>;
}

export async function performSend(
	endpoint: ServerEndpoint,
	myId: string,
	serverId: string | null,
	to: string,
	message: string,
): Promise<SendOutcome> {
	const raw = to.trim();
	const target = raw.includes("@") ? raw : await resolveTarget(endpoint, raw);
	const envelope = {
		id: randomUUID(),
		from: myId,
		to: target,
		text: message,
		sentAt: Date.now(),
	};
	await sendMail(endpoint, envelope);
	return {
		text: `Queued for ${target} on ${serverId} (id ${envelope.id.slice(0, 8)}). Passive: they read it when active.`,
		details: { queued: true, id: envelope.id, to: target, server: serverId },
	};
}
