/**
 * User identity for user mail (issue #5).
 *
 * Two names identify a user: the machine username (auto) and a human-chosen
 * alias (registered with /pi-user-mail). The unique mail id is
 * alias@username. Imports only node modules so it stays unit-testable.
 */

import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

export interface UserIdentity {
	/** Machine-level name. Auto from the OS, overridable in identity.json. */
	username: string;
	/** Human-chosen name, registered with /pi-user-mail <alias>. */
	alias?: string;
}

/** Unique mail id: alias plus username. Bare username when no alias yet. */
export function userMailId(identity: Pick<UserIdentity, "username" | "alias">): string {
	return identity.alias ? `${identity.alias}@${identity.username}` : identity.username;
}

/** Alias rules: 1 to 32 chars, letters, digits, and underscore only. */
export function isValidAlias(alias: string): boolean {
	return /^[A-Za-z0-9_]{1,32}$/.test(alias);
}

/** Storage root for user mail on this machine. */
export function getUserMailDir(agentDir?: string): string {
	const base =
		agentDir ?? process.env.PI_CODING_AGENT_DIR?.trim() ?? join(homedir(), ".pi", "agent");
	return join(isAbsolute(base) ? base : resolve(process.cwd(), base), "pi-user-mail");
}

function identityPath(agentDir?: string): string {
	return join(getUserMailDir(agentDir), "identity.json");
}

/** Local identity. Alias comes from identity.json; username auto-fills. */
export async function getLocalIdentity(agentDir?: string): Promise<UserIdentity> {
	const fallback: UserIdentity = {
		username: process.env.PI_USER_MAIL_USERNAME?.trim() || process.env.USER || "unknown",
	};
	try {
		const raw = await readFile(identityPath(agentDir), "utf-8");
		const parsed = JSON.parse(raw) as Partial<UserIdentity>;
		return {
			...fallback,
			...(typeof parsed.username === "string" && parsed.username.trim()
				? { username: parsed.username.trim() }
				: {}),
			...(typeof parsed.alias === "string" && parsed.alias.trim()
				? { alias: parsed.alias.trim() }
				: {}),
		};
	} catch {
		return fallback;
	}
}

/** Persist the alias. Keeps the rest of identity.json intact. Throws on invalid alias. */
export async function setAlias(alias: string, agentDir?: string): Promise<UserIdentity> {
	if (!isValidAlias(alias)) {
		throw new Error(`Invalid alias ${JSON.stringify(alias)}. Use 1-32 chars: letters, digits, underscore.`);
	}
	const current = await getLocalIdentity(agentDir);
	const next: UserIdentity = { ...current, alias };
	await mkdir(getUserMailDir(agentDir), { recursive: true, mode: 0o700 });
	await writeFile(identityPath(agentDir), JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
	return next;
}
