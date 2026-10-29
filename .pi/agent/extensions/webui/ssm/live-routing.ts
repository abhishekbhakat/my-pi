interface BackendIdentity {
	id?: string;
	path?: string;
	pid?: number;
	parentPid?: number;
	startedAt?: number;
}

/** A session can survive several nested Pi processes. Pick its newest owner, never heartbeat order. */
export function selectLiveBackend<T extends BackendIdentity>(
	backends: Iterable<T>, identity: string | null, processId: string | null = null,
): T | undefined {
	if (!identity) return undefined;
	const all = [...backends];
	const matches = all.filter((backend) => backend.id === identity || backend.path === identity);
	if (processId !== null) {
		if (!/^[1-9]\d*$/.test(processId) || !Number.isSafeInteger(Number(processId))) return undefined;
		return matches.find((backend) => backend.pid === Number(processId));
	}
	const byPid = new Map(all.map((backend) => [backend.pid, backend]));
	const depth = (backend: T) => {
		let result = 0;
		const seen = new Set<number>();
		let parent = backend.parentPid;
		while (parent && !seen.has(parent) && byPid.has(parent)) {
			seen.add(parent); result++;
			parent = byPid.get(parent)?.parentPid;
		}
		return result;
	};
	return matches.reduce<T | undefined>((best, backend) => {
		if (!best) return backend;
		const order = ((backend.startedAt ?? 0) - (best.startedAt ?? 0)) ||
			(depth(backend) - depth(best)) || ((backend.pid ?? 0) - (best.pid ?? 0));
		return order > 0 ? backend : best;
	}, undefined);
}

export function canonicalLiveUrl(url: URL, backend: { pid: number; id?: string; path?: string }): string {
	const target = new URL(url);
	target.pathname = "/live";
	target.searchParams.set("pid", String(backend.pid));
	return target.pathname + target.search;
}
