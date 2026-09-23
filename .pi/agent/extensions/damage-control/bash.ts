import * as path from "node:path";
import * as shlex from "shlex";
import { protectedPathReason } from "./paths";

export interface ParsedCommand {
	tokens: string[];
	baseCommand: string;
	fullCommand: string;
}

const CONTROL_OPERATORS = new Set(["&&", "||", ";", "|", "&", "\n", "(", ")"]);
const MUTATING_COMMANDS = new Set([
	"rm", "mv", "rmdir", "unlink", "cp", "install", "chmod", "chown", "dd", "truncate", "tee",
	"ln", "link", "rsync", "sed", "perl", "ruby",
]);
const WRAPPER_COMMANDS = new Set(["sudo", "env", "nice", "nohup", "command", "time", "stdbuf", "timeout", "ionice"]);
const SHELL_DASH_C = new Set(["bash", "sh", "zsh", "dash", "ksh"]);
const REDIRECT_TARGET = /(?:^|[\s|&;])(?:\d*)>>?\s*([^\s|&;<>]+)/g;

export function getBaseCommandName(cmd: string): string {
	return path.basename(cmd);
}

export function parseShellCommand(command: string): ParsedCommand[] {
	const commands: ParsedCommand[] = [];
	try {
		const tokens = shlex.split(command);
		let currentTokens: string[] = [];
		for (const token of tokens) {
			if (CONTROL_OPERATORS.has(token)) {
				if (currentTokens.length > 0) {
					commands.push({
						tokens: [...currentTokens],
						baseCommand: currentTokens[0] || "",
						fullCommand: currentTokens.join(" "),
					});
					currentTokens = [];
				}
			} else {
				currentTokens.push(token);
			}
		}
		if (currentTokens.length > 0) {
			commands.push({
				tokens: [...currentTokens],
				baseCommand: currentTokens[0] || "",
				fullCommand: currentTokens.join(" "),
			});
		}
	} catch {
		const simpleTokens = command.split(/\s+/).filter((t) => t.length > 0);
		if (simpleTokens.length > 0) {
			commands.push({
				tokens: simpleTokens,
				baseCommand: simpleTokens[0],
				fullCommand: simpleTokens.join(" "),
			});
		}
	}
	return commands;
}

/** Strip sudo/env/timeout wrappers so the real verb is visible. */
export function unwrapWrappers(tokens: string[]): string[] {
	let i = 0;
	while (i < tokens.length) {
		const name = getBaseCommandName(tokens[i] ?? "");
		if (!WRAPPER_COMMANDS.has(name)) break;
		i += 1;
		while (i < tokens.length) {
			const token = tokens[i];
			if (name === "sudo") {
				if (token === "-u" || token === "-g" || token === "-h" || token === "-C" || token === "-p" || token === "-U") {
					i += 2;
					continue;
				}
				if (token.startsWith("-") && token !== "--") {
					i += 1;
					continue;
				}
				break;
			}
			if (name === "env") {
				if (token.includes("=") && !token.startsWith("-")) {
					i += 1;
					continue;
				}
				if (token.startsWith("-") && token !== "--") {
					i += 1;
					continue;
				}
				if (token === "--") {
					i += 1;
					break;
				}
				break;
			}
			if (name === "timeout" || name === "stdbuf" || name === "nice" || name === "ionice") {
				if (token.startsWith("-")) {
					if (token === "-u" || token === "-g" || token === "-p" || token === "-n" || token === "-c" || token === "-t" || token === "-s") {
						i += 2;
						continue;
					}
					i += 1;
					continue;
				}
				if (name === "timeout" && /^\d/.test(token)) {
					i += 1;
					continue;
				}
				break;
			}
			if (token.startsWith("-") && token !== "--") {
				i += 1;
				continue;
			}
			if (token === "--") {
				i += 1;
				break;
			}
			break;
		}
	}
	return tokens.slice(i);
}

function inPlaceEditTargets(name: string, args: string[]): string[] {
	if (name === "sed") {
		const hasInPlace = args.some((arg) => arg === "-i" || arg.startsWith("-i") || arg === "--in-place" || arg.startsWith("--in-place="));
		if (!hasInPlace) return [];
		const nonFlags = args.filter((arg) => !arg.startsWith("-") && arg !== "");
		const start = nonFlags[0] && /^[ssyY]/.test(nonFlags[0]) ? 1 : 0;
		return nonFlags.slice(start);
	}
	if (name === "perl" || name === "ruby") {
		if (!args.some((arg) => arg === "-i" || arg.startsWith("-i") || arg === "-pi" || arg.startsWith("-pi"))) return [];
		return args.filter((arg) => !arg.startsWith("-"));
	}
	return [];
}

function mutatingTargets(name: string, args: string[]): string[] {
	if (name === "dd") return args.filter((arg) => arg.startsWith("of="));
	if (name === "cp" || name === "install" || name === "ln" || name === "link" || name === "mv") {
		return args.filter((arg) => !arg.startsWith("-")).slice(-1);
	}
	if (name === "rsync") return args.filter((arg) => !arg.startsWith("-")).slice(-1);
	if (name === "tee") return args.filter((arg) => !arg.startsWith("-"));
	if (name === "chmod" || name === "chown") {
		return args.filter((arg) => !arg.startsWith("-")).slice(1);
	}
	const inPlace = inPlaceEditTargets(name, args);
	if (inPlace.length > 0) return inPlace;
	if (MUTATING_COMMANDS.has(name)) return args.filter((arg) => !arg.startsWith("-") && !arg.startsWith("of="));
	return [];
}

export function redirectTargetReasons(command: string, cwd: string): string | null {
	REDIRECT_TARGET.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = REDIRECT_TARGET.exec(command)) !== null) {
		const reason = protectedPathReason(match[1], cwd);
		if (reason) return `redirect to ${reason}`;
	}
	return null;
}

export function protectedBashReason(parsed: ParsedCommand, cwd: string): string | null {
	const unwrapped = unwrapWrappers(parsed.tokens);
	if (unwrapped.length === 0) return null;

	const shellName = getBaseCommandName(unwrapped[0] ?? "");
	if (SHELL_DASH_C.has(shellName)) {
		const cIndex = unwrapped.findIndex((token) => token === "-c");
		if (cIndex >= 0 && unwrapped[cIndex + 1]) {
			const nested = evaluatePathGuards(unwrapped[cIndex + 1], cwd);
			if (nested) return nested;
		}
	}

	const name = getBaseCommandName(unwrapped[0] ?? "");
	if (!MUTATING_COMMANDS.has(name) && name !== "mkfs" && !name.startsWith("mkfs.")) return null;

	const args = unwrapped.slice(1);
	const targets = mutatingTargets(name, args);
	for (const token of targets) {
		if (name === "dd" && token === "of=/dev/null") continue;
		if ((name === "dd" && token.startsWith("of=/dev/")) ||
			((name === "mkfs" || name.startsWith("mkfs.")) && token.startsWith("/dev/"))) {
			return "device writes are protected";
		}
		const reason = protectedPathReason(token, cwd);
		if (reason) return reason;
	}
	return null;
}

/**
 * A shell variable is only trusted when this entire, deliberately small command
 * shape keeps it bound to the path just created by mktemp.
 */
export function isProvenTemporaryCleanup(command: string): boolean {
	const assignment = command.match(
		/^\s*([a-z][a-z0-9_]*)=\$\(mktemp(?: -d)? (\/(?:tmp|private\/tmp)\/[A-Za-z0-9._-]*X{6,})\)\s*&&\s*/,
	);
	if (!assignment) return false;

	const variable = assignment[1];
	const steps = command.slice(assignment[0].length).trim().split(/\s*&&\s*/);
	if (steps.length === 0 || steps.some((step) => !step)) return false;

	let removed = false;
	for (const step of steps) {
		const removal = step.match(/^rm\s+-(?:rf|fr|f)\s+"\$([a-z][a-z0-9_]*)"$/);
		if (removal) {
			if (removed || removal[1] !== variable) return false;
			removed = true;
			continue;
		}

		const touch = step.match(/^touch\s+"\$([a-z][a-z0-9_]*)\/([A-Za-z0-9._/-]+)"$/);
		if (
			touch &&
			!removed &&
			touch[1] === variable &&
			touch[2].split("/").every((part) => part && part !== "." && part !== "..")
		) {
			continue;
		}

		const listing = step.match(/^ls(?:\s+-[A-Za-z]+)?\s+"\$([a-z][a-z0-9_]*)"(?:\s+2>&1)?$/);
		if (listing && listing[1] === variable) continue;

		const report = step.match(/^echo\s+"(?:removed|created) \$([a-z][a-z0-9_]*)"$/);
		if (report && report[1] === variable) continue;

		return false;
	}
	return removed;
}

/** Hard path/device guards only. Policy (git, rm -rf, cloud) goes to Jev. */
export function evaluatePathGuards(command: string, cwd: string): string | null {
	const redirect = redirectTargetReasons(command, cwd);
	if (redirect) return redirect;

	const provenTemporaryCleanup = isProvenTemporaryCleanup(command);
	for (const parsed of parseShellCommand(command)) {
		if (provenTemporaryCleanup && getBaseCommandName(unwrapWrappers(parsed.tokens)[0] ?? "") === "rm") {
			continue;
		}
		const reason = protectedBashReason(parsed, cwd);
		if (reason) return reason;
	}
	return null;
}

export function commandNeedsSemanticReview(
	command: string,
	needsReview: (tokens: string[]) => boolean,
): boolean {
	if (isProvenTemporaryCleanup(command)) {
		return parseShellCommand(command).some((part) => {
			const tokens = unwrapWrappers(part.tokens);
			if (getBaseCommandName(tokens[0] ?? "") === "rm") return false;
			return needsReview(tokens);
		});
	}
	return parseShellCommand(command).some((part) => needsReview(unwrapWrappers(part.tokens)));
}
