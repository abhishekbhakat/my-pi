import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import { errorCode, unlinkIfPresent, withNameLock } from "./lock.ts";
import { isProcessId, readProcessStarts } from "./process.ts";

export type PagerPresence = { key: string; lastActiveMs: number; cwd: string };
type Owner = { pid: number; processStart: string; pager?: PagerPresence };

export type SessionName = Owner & {
	name: string;
	id: string;
	shortId: string;
	cwd: string;
	otherOwners?: Owner[];
};

type Project = { prefix: string };
type Registry = { projects: Map<string, Project>; sessions: Map<string, SessionName> };

const REGISTRY_FILE = "names.json";

function sameOwner(a: Owner, b: Owner): boolean {
	return a.pid === b.pid && a.processStart === b.processStart;
}

function owners(session: SessionName): Owner[] {
	const { pid, processStart, pager, otherOwners = [] } = session;
	return [{ pid, processStart, pager }, ...otherOwners];
}

function withOwners(session: SessionName, live: Owner[]): SessionName {
	const { name, id, shortId, cwd } = session;
	return { name, id, shortId, cwd, ...live[0]!, ...(live.length > 1 ? { otherOwners: live.slice(1) } : {}) };
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isPagerKey(key: unknown): key is string {
	return typeof key === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(key);
}

function validPresence(value: unknown): value is PagerPresence {
	return record(value) && isPagerKey(value.key) && typeof value.lastActiveMs === "number" &&
		Number.isSafeInteger(value.lastActiveMs) && value.lastActiveMs > 0 &&
		typeof value.cwd === "string" && isAbsolute(value.cwd);
}

function validOwner(value: unknown): value is Owner & Record<string, unknown> {
	return record(value) && isProcessId(value.pid) && typeof value.processStart === "string" &&
		value.processStart.length > 0 && (value.pager === undefined || validPresence(value.pager));
}

function validId(id: string): boolean {
	return /^[a-z0-9][a-z0-9-]*$/i.test(id);
}

async function readRegistry(mailDir: string): Promise<Registry> {
	const registry: Registry = { projects: new Map(), sessions: new Map() };
	let raw: string;
	try {
		raw = await readFile(join(mailDir, REGISTRY_FILE), "utf-8");
	} catch (error) {
		if (errorCode(error) === "ENOENT") return registry;
		throw error;
	}
	const parsed: unknown = JSON.parse(raw);
	const invalid = () => new Error("Invalid pi-mail names.json; leaving the registry unchanged");
	if (!record(parsed) || !record(parsed.projects) || !record(parsed.sessions)) throw invalid();

	const prefixes = new Set<string>();
	for (const [cwd, project] of Object.entries(parsed.projects)) {
		if (!isAbsolute(cwd) || !record(project) || typeof project.prefix !== "string" ||
			!/^[a-z]{2,}$/.test(project.prefix) || prefixes.has(project.prefix)) throw invalid();
		prefixes.add(project.prefix);
		registry.projects.set(cwd, { prefix: project.prefix });
	}

	const names = new Set<string>();
	for (const [id, session] of Object.entries(parsed.sessions)) {
		if (!validId(id) || !validOwner(session) || session.id !== id || session.shortId !== id.slice(0, 8) ||
			typeof session.cwd !== "string" || typeof session.name !== "string" ||
			(session.otherOwners !== undefined && (!Array.isArray(session.otherOwners) || !session.otherOwners.every(validOwner)))) throw invalid();
		const prefix = /^([a-z]+)[1-9][0-9]*$/.exec(session.name)?.[1];
		if (!prefix || prefix !== registry.projects.get(session.cwd)?.prefix || names.has(session.name)) throw invalid();
		names.add(session.name);
		registry.sessions.set(id, session as SessionName);
	}
	return registry;
}

async function writeRegistry(mailDir: string, registry: Registry): Promise<void> {
	const path = join(mailDir, REGISTRY_FILE);
	const temp = `${path}.${randomUUID()}.tmp`;
	try {
		await writeFile(temp, JSON.stringify({
			projects: Object.fromEntries(registry.projects),
			sessions: Object.fromEntries(registry.sessions),
		}, null, 2) + "\n", { mode: 0o600, flag: "wx" });
		await rename(temp, path);
	} finally {
		await unlinkIfPresent(temp);
	}
}

async function pruneSessions(registry: Registry): Promise<{ live: Map<string, SessionName>; changed: boolean }> {
	const live = new Map<string, SessionName>();
	const starts = await readProcessStarts([...registry.sessions.values()].flatMap((session) => owners(session).map(({ pid }) => pid)));
	let changed = false;
	for (const [id, session] of registry.sessions) {
		const claims = owners(session);
		const remaining = claims.filter(({ pid, processStart }) => {
			const actual = starts.get(pid);
			return actual === undefined || actual === processStart;
		});
		let current = session;
		if (remaining.length !== claims.length) {
			changed = true;
			if (remaining.length === 0) {
				registry.sessions.delete(id);
				continue;
			}
			current = withOwners(session, remaining);
			registry.sessions.set(id, current);
		}
		const confirmed = remaining.filter(({ pid, processStart }) => starts.get(pid) === processStart)
			.sort((a, b) => (b.pager?.lastActiveMs ?? 0) - (a.pager?.lastActiveMs ?? 0) || a.pid - b.pid);
		if (confirmed.length > 0) live.set(id, withOwners(current, confirmed));
	}
	return { live, changed };
}

export async function readSessionNames(mailDir: string): Promise<ReadonlyMap<string, SessionName>> {
	try {
		const snapshot = await pruneSessions(await readRegistry(mailDir));
		if (!snapshot.changed) return snapshot.live;
		return await withNameLock(mailDir, async () => {
			const registry = await readRegistry(mailDir);
			const { live, changed } = await pruneSessions(registry);
			if (changed) await writeRegistry(mailDir, registry);
			return live;
		});
	} catch {
		return new Map(); // Exact IDs and unique ID prefixes still work without aliases.
	}
}

function choosePrefix(cwd: string, projects: Iterable<Project>): string {
	const words = basename(cwd)
		.replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
		.replace(/([a-z])([A-Z])/g, "$1 $2")
		.toLowerCase().match(/[a-z]+/g) ?? [];
	const letters = words.join("");
	const initials = words.map((word) => word[0]).join("");
	const prefix = (words.length > 1 ? initials : letters || "s").slice(0, 2).padEnd(2, "x");
	const used = new Set(Array.from(projects, ({ prefix }) => prefix));
	if (!used.has(prefix)) return prefix;
	const third = initials[2] ?? letters[2];
	if (third && !used.has(prefix + third)) return prefix + third;
	for (let suffix = "a"; ; suffix = nextSuffix(suffix)) {
		if (!used.has(prefix + suffix)) return prefix + suffix;
	}
}

function nextSuffix(suffix: string): string {
	const tail = suffix.slice(-1);
	if (tail !== "z") return suffix.slice(0, -1) + String.fromCharCode(tail.charCodeAt(0) + 1);
	return (suffix.length === 1 ? "a" : nextSuffix(suffix.slice(0, -1))) + "a";
}

async function currentProcess(): Promise<Owner | undefined> {
	const pid = process.pid;
	const processStart = (await readProcessStarts([pid])).get(pid);
	return processStart ? { pid, processStart } : undefined;
}

export async function assignSessionName(
	mailDir: string, id: string, cwd: string, pager?: PagerPresence,
): Promise<string | undefined> {
	if (process.env.PI_CAPABILITY_CHILD === "1") return;
	if (!validId(id)) throw new Error("Invalid pi-mail session id");
	const owner = await currentProcess();
	if (!owner) throw new Error("Could not determine process start time for pi-mail session names");
	owner.pager = pager;

	return withNameLock(mailDir, async () => {
		const registry = await readRegistry(mailDir);
		let { changed } = await pruneSessions(registry);
		// A process can serve only its current session, even if the last shutdown missed its release.
		for (const [otherId, session] of registry.sessions) {
			if (otherId === id) continue;
			const claims = owners(session);
			const remaining = claims.filter((claim) => !sameOwner(claim, owner));
			if (remaining.length === claims.length) continue;
			if (remaining.length > 0) registry.sessions.set(otherId, withOwners(session, remaining));
			else registry.sessions.delete(otherId);
			changed = true;
		}
		const existing = registry.sessions.get(id);
		if (existing) {
			const claims = owners(existing);
			const previous = claims.find((claim) => sameOwner(claim, owner));
			if (changed || !previous || previous.pager || pager) {
				registry.sessions.set(id, withOwners(existing, [...claims.filter((claim) => claim !== previous), owner]));
				await writeRegistry(mailDir, registry);
			}
			return existing.name;
		}

		const projectPath = resolve(cwd);
		const project = registry.projects.get(projectPath) ?? { prefix: choosePrefix(projectPath, registry.projects.values()) };
		const used = new Set(Array.from(registry.sessions.values(), ({ name }) => name));
		let number = 1;
		while (used.has(`${project.prefix}${number}`)) number++;
		const name = `${project.prefix}${number}`;
		registry.projects.set(projectPath, project);
		registry.sessions.set(id, { name, id, shortId: id.slice(0, 8), cwd: projectPath, ...owner });
		await writeRegistry(mailDir, registry);
		return name;
	});
}

export async function touchPagerPresence(mailDir: string, id: string, key: string, at: number): Promise<void> {
	await withNameLock(mailDir, async () => {
		const registry = await readRegistry(mailDir);
		const session = registry.sessions.get(id);
		if (!session) return;
		const claims = owners(session);
		const presence = claims.find((claim) => claim.pid === process.pid && claim.pager?.key === key)?.pager;
		if (!presence || presence.lastActiveMs >= at) return;
		presence.lastActiveMs = at;
		registry.sessions.set(id, withOwners(session, claims));
		await writeRegistry(mailDir, registry);
	});
}

export async function releaseSessionName(mailDir: string, id: string): Promise<void> {
	const owner = await currentProcess();
	if (!owner) return;
	await withNameLock(mailDir, async () => {
		const registry = await readRegistry(mailDir);
		const session = registry.sessions.get(id);
		if (!session) return;
		const claims = owners(session);
		const remaining = claims.filter((claim) => !sameOwner(claim, owner));
		if (remaining.length === claims.length) return;
		if (remaining.length > 0) registry.sessions.set(id, withOwners(session, remaining));
		else registry.sessions.delete(id);
		await writeRegistry(mailDir, registry);
	});
}
