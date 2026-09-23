import { spawn, spawnSync } from "node:child_process";
import type { ModelThinkingLevel, ThinkingLevel, ThinkingLevelMap } from "@earendil-works/pi-ai";

export const STATUS_TIMEOUT_MS = 4_000;
export const REQUEST_TIMEOUT_MS = 5 * 60_000;
export const STDERR_LIMIT = 20_000;

export type CliStatus = {
	ok: boolean;
	summary: string;
	detail?: string;
};

export type SessionArgMode = "none" | "seed" | "resume";

export function claudeBin(): string {
	return process.env.CLAUDE_CODE_PI_BIN?.trim() || "claude";
}

export function requestTimeoutMs(): number {
	const configured = Number(process.env.CLAUDE_CODE_PI_TIMEOUT_MS);
	if (Number.isFinite(configured) && configured > 0) return configured;
	return REQUEST_TIMEOUT_MS;
}

const PI_LEVELS: ThinkingLevel[] = ["minimal", "low", "medium", "high", "xhigh", "max"];

/**
 * Reads the `--effort` choices from `claude --help`, e.g.
 * `--effort <level>  Effort level ... (low, medium, high, xhigh, max)`.
 * Returns [] when the flag or its choice list is missing.
 */
export function parseEffortLevels(help: string): string[] {
	const match = help.match(/--effort\b[\s\S]{0,300}?\(([^)]*)\)/);
	if (!match) return [];
	return match[1]
		.split(",")
		.map((level) => level.trim())
		.filter((level) => /^[a-z]+$/.test(level));
}

export function detectEffortLevels(): string[] {
	const result = spawnSync(claudeBin(), ["--help"], { encoding: "utf8", timeout: STATUS_TIMEOUT_MS });
	if (result.error || result.status !== 0) return [];
	return parseEffortLevels(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
}

/**
 * Builds Pi's thinkingLevelMap from the CLI's effort choices. Levels the CLI
 * names are passed through; `minimal` falls back to the lowest CLI level; every
 * other Pi level is marked unsupported (null) so Pi hides it. `off` stays
 * unmapped: the CLI has no off effort, so no flag is sent.
 */
export function buildThinkingLevelMap(effortLevels: string[]): ThinkingLevelMap | undefined {
	if (effortLevels.length === 0) return undefined;
	const map: ThinkingLevelMap = {};
	for (const level of PI_LEVELS) {
		if (effortLevels.includes(level)) map[level] = level;
		else if (level === "minimal") map[level] = effortLevels[0];
		else map[level] = null;
	}
	return map;
}

// Without a detected map the CLI default effort applies; guessing a value
// the installed CLI may reject would fail the whole turn.
export function effortArgs(level: ModelThinkingLevel | undefined, map?: ThinkingLevelMap): string[] {
	if (!level || level === "off") return [];
	const effort = map?.[level];
	return effort ? ["--effort", effort] : [];
}

export function buildClaudeArgs(options: {
	modelId: string;
	reasoning?: ModelThinkingLevel;
	thinkingLevelMap?: ThinkingLevelMap;
	useStreamJson?: boolean;
	sessionMode?: SessionArgMode;
	claudeSessionId?: string;
	sessionName?: string;
}): string[] {
	const args = ["-p", "--model", options.modelId, "--permission-mode", "dontAsk", "--tools", ""];
	const mode = options.sessionMode ?? "none";
	if (mode === "none" || !options.claudeSessionId) {
		args.push("--no-session-persistence");
	} else if (mode === "resume") {
		args.push("--resume", options.claudeSessionId);
	} else {
		args.push("--session-id", options.claudeSessionId);
	}
	if (options.sessionName) args.push("-n", options.sessionName);
	args.push(...effortArgs(options.reasoning, options.thinkingLevelMap));
	args.push("--output-format", "stream-json", "--verbose");
	if (options.useStreamJson) args.push("--input-format", "stream-json");
	return args;
}

export function runCapture(
	args: string[],
	input?: string,
	timeoutMs = STATUS_TIMEOUT_MS,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
	return new Promise((resolve, reject) => {
		const child = spawn(claudeBin(), args, {
			stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
			env: { ...process.env },
		});

		let stdout = "";
		let stderr = "";
		const timer = setTimeout(() => {
			child.kill("SIGTERM");
			reject(new Error(`claude timed out after ${timeoutMs}ms`));
		}, timeoutMs);

		child.stdout!.setEncoding("utf8");
		child.stderr!.setEncoding("utf8");
		child.stdout!.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr!.on("data", (chunk) => {
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
			const detail = result.stderr.trim() || result.stdout.trim() || `claude --version exited with code ${result.code}`;
			return { ok: false, summary: "Claude Code CLI is unusable", detail };
		}
		const version = result.stdout.trim() || result.stderr.trim() || "claude is available";
		return { ok: true, summary: version };
	} catch (error) {
		return {
			ok: false,
			summary: "Claude Code CLI is unavailable",
			detail: error instanceof Error ? error.message : String(error),
		};
	}
}

export function setupGuidance(error: string): string {
	return [
		"claude-code-pi could not use the local Claude Code CLI.",
		`Reason: ${error}`,
		"Install Claude Code, ensure `claude --version` works on PATH, authenticate Claude Code if needed, then reload Pi.",
		"This provider never falls back to Anthropic SDK, HTTP APIs, or Pi built-in Claude providers; every request must go through `claude -p`.",
	].join(" ");
}

/**
 * Only blame the CLI when `claude --version` actually fails. Any other throw
 * (prompt serialization, parse, session mismatch) is a bridge bug and must
 * surface as itself, not as install advice.
 */
export async function describeStreamError(error: unknown): Promise<string> {
	const reason = error instanceof Error ? error.message : String(error);
	const status = await checkCliStatus();
	if (status.ok) return `claude-code-pi bridge error: ${reason}`;
	return setupGuidance(status.detail ?? reason);
}
