import { getAgentDirPath } from "../../mail/mailbox.ts";
import { ping, type ServerEndpoint } from "../client.ts";
import { runElection, type ElectionResult, type Role } from "../election.ts";
import { getLocalIdentity, getUserMailDir } from "../identity.ts";

export const USER_MAIL_CUSTOM_TYPE = "pi_user_mail_message";
export const STATUS_ID = "pi-user-mail";
export const NEVER_SERVER = process.env.PI_USER_MAIL_SERVER?.trim() === "never";

let election: ElectionResult | null = null;
let electing: Promise<ElectionResult> | undefined;
let check: Promise<void> | undefined;
let closing = false;
let onRole: ((role: Role) => void) | undefined;

export function startElection(observer: (role: Role) => void): Promise<ElectionResult> {
	closing = false;
	onRole = observer;
	return ensureElected();
}

/** Invalidate only the client endpoint that actually failed. */
export function invalidateClient(endpoint: ServerEndpoint): boolean {
	if (election?.role !== "client" || election.endpoint !== endpoint) return false;
	election = null;
	onRole?.("none");
	return true;
}

/** Recheck the cached client on demand; never start a background poller. */
export async function ensureElected(): Promise<ElectionResult> {
	if (election?.role === "client" && election.endpoint) {
		const endpoint = election.endpoint;
		check ??= (async () => {
			const reply = await ping(endpoint);
			if (reply && election?.endpoint === endpoint) election.serverId = reply.id;
			else invalidateClient(endpoint);
		})().finally(() => { check = undefined; });
		await check;
	}
	if (election) return election;
	if (closing) return { role: "none", endpoint: null, serverId: null };
	if (!electing) {
		electing = (async () => {
			const agentDir = getAgentDirPath();
			const result = await runElection({
				identity: await getLocalIdentity(agentDir),
				rootDir: getUserMailDir(agentDir),
				never: NEVER_SERVER,
				onRoleChange: (updated) => {
					if (election === updated) onRole?.(updated.role);
				},
			});
			// Do not cache failure, including join-only sessions that start before a server.
			if (result.role !== "none") election = result;
			onRole?.(result.role);
			return result;
		})().finally(() => { electing = undefined; });
	}
	return electing;
}

export function setChip(
	ctx: { hasUI: boolean; ui: { setStatus(id: string, text: string | undefined): void } },
	role: Role,
): void {
	if (ctx.hasUI) ctx.ui.setStatus(STATUS_ID, role === "server" ? "srv" : undefined);
}

export async function stopOwnedServer(): Promise<void> {
	closing = true;
	onRole = undefined;
	await electing?.catch(() => {});
	const owned = election;
	election = null;
	if (!owned) return;
	const { discovery, server } = owned;
	owned.role = "none";
	await Promise.all([discovery?.stop(), server?.stop()]);
}
