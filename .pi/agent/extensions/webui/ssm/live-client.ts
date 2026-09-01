import { SSM_ORIGIN } from "./constants";

export interface LiveRegistration {
	port: number;
	pid: number;
	id?: string;
	path?: string;
	cwd?: string;
}

export async function registerLive(info: LiveRegistration): Promise<boolean> {
	try {
		const res = await fetch(`${SSM_ORIGIN}/api/live`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(info),
			signal: AbortSignal.timeout(1500),
		});
		return res.ok;
	} catch {
		return false;
	}
}

export async function unregisterLive(pid: number): Promise<void> {
	try {
		await fetch(`${SSM_ORIGIN}/api/live`, {
			method: "DELETE",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ pid }),
			signal: AbortSignal.timeout(800),
		});
	} catch {
		// daemon may already be gone
	}
}
