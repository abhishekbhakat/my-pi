import { spawn } from "node:child_process";

export const STATUS_TIMEOUT_MS = 4_000;
export const REQUEST_TIMEOUT_MS = 5 * 60_000;
export const STDERR_LIMIT = 20_000;

// Matches no Vibe tool, so --enabled-tools leaves the agent with zero tools.
// Vibe must never execute actions itself; Pi executes all tools.
export const TOOL_NONE = "__none__";

export type CliStatus = {
	ok: boolean;
	summary: string;
	detail?: string;
};

export function vibeBin(): string {
	return process.env.MISTRAL_VIBE_CLI_BIN?.trim() || "vibe";
}

// Vibe owns its auth through ~/.vibe/.env and its model choice through
// ~/.vibe/config.toml. Inherited values would silently retarget it.
const STRIP_ENV = ["VIBE_ACTIVE_MODEL", "MISTRAL_API_KEY"];

export function vibeEnv(modelId: string): NodeJS.ProcessEnv {
	const env = { ...process.env };
	for (const name of STRIP_ENV) delete env[name];
	if (modelId !== "default") env.VIBE_ACTIVE_MODEL = modelId;
	return env;
}

export function requestTimeoutMs(): number {
	const configured = Number(process.env.MISTRAL_VIBE_CLI_TIMEOUT_MS);
	if (Number.isFinite(configured) && configured > 0) return configured;
	return REQUEST_TIMEOUT_MS;
}

// The prompt travels over stdin: transcripts can exceed argv limits.
export function buildVibeArgs(): string[] {
	return ["-p", "--enabled-tools", TOOL_NONE, "--output", "json", "--max-turns", "1"];
}

export function runCapture(
	args: string[],
	input?: string,
	timeoutMs = STATUS_TIMEOUT_MS,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
	return new Promise((resolve, reject) => {
		const child = spawn(vibeBin(), args, {
			stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
			env: { ...process.env },
		});

		let stdout = "";
		let stderr = "";
		const timer = setTimeout(() => {
			child.kill("SIGTERM");
			reject(new Error(`vibe timed out after ${timeoutMs}ms`));
		}, timeoutMs);

		child.stdout!.setEncoding("utf8");
		child.stderr!.setEncoding("utf8");
		child.stdout!.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr!.on("data", (chunk: string) => {
			stderr = (stderr + chunk).slice(-STDERR_LIMIT);
		});
		child.on("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve({ stdout, stderr, code });
		});

		if (input !== undefined) child.stdin!.end(input);
	});
}

export async function checkCliStatus(): Promise<CliStatus> {
	try {
		const result = await runCapture(["--version"]);
		if (result.code !== 0) {
			const detail = result.stderr.trim() || result.stdout.trim() || `vibe --version exited with code ${result.code}`;
			return { ok: false, summary: "Mistral Vibe CLI is unusable", detail };
		}
		const version = result.stdout.trim() || result.stderr.trim() || "vibe is available";
		return { ok: true, summary: version };
	} catch (error) {
		return {
			ok: false,
			summary: "Mistral Vibe CLI is unavailable",
			detail: error instanceof Error ? error.message : String(error),
		};
	}
}

export function setupGuidance(error: string): string {
	return [
		"mistral-vibe-cli could not use the local Mistral Vibe CLI.",
		`Reason: ${error}`,
		"Install it with `uv tool install mistral-vibe`, ensure `vibe --version` works on PATH, authenticate Vibe if needed, then reload Pi.",
		"This provider never falls back to the Mistral HTTP API or Pi built-in Mistral providers; every request must go through `vibe -p`.",
	].join(" ");
}

/**
 * Only blame the CLI when `vibe --version` actually fails. Any other throw
 * (prompt serialization, parse) is a bridge bug and must surface as itself.
 */
export async function describeStreamError(error: unknown): Promise<string> {
	const reason = error instanceof Error ? error.message : String(error);
	const status = await checkCliStatus();
	if (status.ok) return `mistral-vibe-cli bridge error: ${reason}`;
	return setupGuidance(status.detail ?? reason);
}
