/**
 * Election state for one session (issue #5).
 *
 * Caches the elected role, runs the election on demand, and owns the srv
 * chip. Client and server roles cache for the session; a failed claim is
 * never cached so the next call retries. No @earendil-works imports.
 */

import { getAgentDirPath } from "../../mailbox.ts";
import { runElection, type ElectionResult } from "../election.ts";
import { getLocalIdentity, getUserMailDir } from "../identity.ts";

export const USER_MAIL_CUSTOM_TYPE = "pi_user_mail_message";

/** Footer status id; the "srv" chip sits beside fast and yolo. */
export const STATUS_ID = "pi-user-mail";

/** PI_USER_MAIL_SERVER=never: join, but never claim the server role. */
export const NEVER_SERVER = process.env.PI_USER_MAIL_SERVER?.trim() === "never";

let election: ElectionResult | null = null;
let electing: Promise<ElectionResult | null> | null = null;

export function cachedElection(): ElectionResult | null {
	return election;
}

/** Drop the cached result; the next ensureElected re-elects. */
export function dropElection(): void {
	election = null;
}

/** Find or claim the network server. */
export async function ensureElected(): Promise<ElectionResult | null> {
	if (election && (election.role !== "none" || NEVER_SERVER)) return election;
	if (!electing) {
		electing = (async () => {
			const agentDir = getAgentDirPath();
			const result = await runElection({
				identity: await getLocalIdentity(agentDir),
				rootDir: getUserMailDir(agentDir),
				never: NEVER_SERVER,
			});
			if (result.role !== "none" || NEVER_SERVER) election = result;
			return result;
		})();
	}
	try {
		return await electing;
	} finally {
		electing = null;
	}
}

export function setChip(
	ctx: { hasUI: boolean; ui: { setStatus(id: string, text: string | undefined): void } },
	on: boolean,
): void {
	if (ctx.hasUI) ctx.ui.setStatus(STATUS_ID, on ? "srv" : undefined);
}

/** Stop a server and discovery this session owns. Called on session shutdown. */
export async function stopOwnedServer(): Promise<void> {
	const owned = election;
	election = null;
	await owned?.discovery?.stop();
	await owned?.server?.stop();
}
