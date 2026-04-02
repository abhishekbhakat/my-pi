import type { ExtensionAPI, ToolCallEvent } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { parse as yamlParse } from "yaml";
import * as shlex from "shlex";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

interface Rule {
	pattern: string;
	reason: string;
	ask?: boolean;
}

interface Rules {
	bashToolPatterns: Rule[];
	zeroAccessPaths: string[];
	readOnlyPaths: string[];
	noDeletePaths: string[];
}

// Shell control operators that separate commands
const CONTROL_OPERATORS = new Set(["&&", "||", ";", "|", "&", "\n", "(", ")"]);

interface ParsedCommand {
	tokens: string[];
	baseCommand: string;
	fullCommand: string; // Reconstructed for pattern matching
	isSubshell: boolean;
}

interface WrapperCommand {
	unwrap(tokens: string[]): CommandMatchContext | null;
}

interface CommandMatchContext {
	commandName: string;
	commandString: string;
	suppressDirectRules?: boolean;
}

const UV_SAFE_WRAPPED_COMMANDS = new Set(["pip", "pip3", "python", "python3"]);

const WRAPPER_COMMANDS: Record<string, WrapperCommand> = {
	uv: {
		unwrap(tokens) {
			if (tokens.length < 2) return null;
			if (tokens[1] === "run") {
				if (tokens.length < 3) return null;
				const actualTokens = tokens.slice(2);
				const commandName = getBaseCommandName(actualTokens[0]);
				return {
					commandName,
					commandString: actualTokens.join(" "),
					suppressDirectRules: UV_SAFE_WRAPPED_COMMANDS.has(commandName),
				};
			}
			const actualTokens = tokens.slice(1);
			const commandName = getBaseCommandName(actualTokens[0]);
			return {
				commandName,
				commandString: actualTokens.join(" "),
				suppressDirectRules: UV_SAFE_WRAPPED_COMMANDS.has(commandName),
			};
		},
	},
};

function parseShellCommand(command: string): ParsedCommand[] {
	const commands: ParsedCommand[] = [];

	try {
		const tokens = shlex.split(command);

		let currentTokens: string[] = [];
		let isSubshell = false;

		for (const token of tokens) {
			if (CONTROL_OPERATORS.has(token)) {
				if (currentTokens.length > 0) {
					commands.push({
						tokens: [...currentTokens],
						baseCommand: currentTokens[0] || "",
						fullCommand: currentTokens.join(" "),
						isSubshell,
					});
					currentTokens = [];
				}
				if (token === "(") isSubshell = true;
				if (token === ")") isSubshell = false;
			} else {
				currentTokens.push(token);
			}
		}

		if (currentTokens.length > 0) {
			commands.push({
				tokens: [...currentTokens],
				baseCommand: currentTokens[0] || "",
				fullCommand: currentTokens.join(" "),
				isSubshell,
			});
		}
	} catch (err) {
		// Fallback: simple space splitting
		const simpleTokens = command.split(/\s+/).filter((t) => t.length > 0);
		if (simpleTokens.length > 0) {
			commands.push({
				tokens: simpleTokens,
				baseCommand: simpleTokens[0],
				fullCommand: simpleTokens.join(" "),
				isSubshell: false,
			});
		}
	}

	return commands;
}

function getBaseCommandName(cmd: string): string {
	return path.basename(cmd);
}

function getRuleTargetCommand(pattern: string): string | null {
	const trimmed = pattern.trim();
	if (!trimmed) return null;

	const hasRegexSpecialChars = /[.*+?^${}()|[\]\\]/.test(trimmed);
	if (!hasRegexSpecialChars) {
		return trimmed.includes("/") ? getBaseCommandName(trimmed) : trimmed;
	}

	let remaining = trimmed;
	for (;;) {
		const next = remaining
			.replace(/^(?:\^|\\b|\\A|\\s+)+/, "")
			.replace(
				/^(?:\(\?<=[^)]*\)|\(\?<![^)]*\)|\(\?=[^)]*\)|\(\?![^)]*\))/,
				"",
			)
			.trimStart();
		if (next === remaining) break;
		remaining = next;
	}

	if (remaining.startsWith("/") || remaining.startsWith("~")) {
		const pathMatch = remaining.match(/^([^\s\\]+)/);
		return pathMatch ? getBaseCommandName(pathMatch[1]) : null;
	}

	const commandMatch = remaining.match(/^([A-Za-z0-9_.:-]+)/);
	return commandMatch ? getBaseCommandName(commandMatch[1]) : null;
}

function getCommandMatchContexts(parsed: ParsedCommand): {
	direct: CommandMatchContext;
	actual: CommandMatchContext | null;
} {
	const direct: CommandMatchContext = {
		commandName: getBaseCommandName(parsed.baseCommand),
		commandString: parsed.fullCommand,
	};
	const wrapper = WRAPPER_COMMANDS[direct.commandName];

	if (!wrapper) {
		return {
			direct,
			actual: null,
		};
	}

	const actual = wrapper.unwrap(parsed.tokens);
	if (!actual) {
		return {
			direct,
			actual: null,
		};
	}

	return {
		direct,
		actual,
	};
}

function matchesPattern(commandStr: string, pattern: string): boolean {
	// Pattern can be:
	// - Simple command name: "rm", "python"
	// - Regex pattern: "\brm\s+-[rRf]"
	// - Path pattern: "/usr/bin/python"

	// Check if pattern has regex special chars
	const hasRegexSpecialChars = /[.*+?^${}()|[\]\\]/.test(pattern);

	if (hasRegexSpecialChars) {
		try {
			const regex = new RegExp(pattern);
			return regex.test(commandStr);
		} catch {
			// Invalid regex, fall through
		}
	}

	// Simple string matching
	if (pattern.includes("/")) {
		return commandStr === pattern || commandStr.endsWith(pattern);
	}

	// Match base command name
	const baseCmd = getBaseCommandName(commandStr.split(" ")[0]);
	return baseCmd === pattern;
}

function matchesCommandRule(parsed: ParsedCommand, pattern: string): boolean {
	const { direct, actual } = getCommandMatchContexts(parsed);
	const ruleTarget = getRuleTargetCommand(pattern);

	if (!ruleTarget) {
		return matchesPattern(direct.commandString, pattern);
	}

	if (direct.commandName === ruleTarget && matchesPattern(direct.commandString, pattern)) {
		return true;
	}

	if (
		actual &&
		!actual.suppressDirectRules &&
		actual.commandName === ruleTarget &&
		matchesPattern(actual.commandString, pattern)
	) {
		return true;
	}

	return false;
}

export default function (pi: ExtensionAPI) {
	let rules: Rules = {
		bashToolPatterns: [],
		zeroAccessPaths: [],
		readOnlyPaths: [],
		noDeletePaths: [],
	};

	function resolvePath(p: string, cwd: string): string {
		if (p.startsWith("~")) {
			p = path.join(os.homedir(), p.slice(1));
		}
		return path.resolve(cwd, p);
	}

	function isPathMatch(targetPath: string, pattern: string, cwd: string): boolean {
		const resolvedPattern = pattern.startsWith("~")
			? path.join(os.homedir(), pattern.slice(1))
			: pattern;

		if (resolvedPattern.endsWith("/")) {
			const absolutePattern = path.isAbsolute(resolvedPattern)
				? resolvedPattern
				: path.resolve(cwd, resolvedPattern);
			return targetPath.startsWith(absolutePattern);
		}

		const regexPattern = resolvedPattern
			.replace(/[.+^${}()|[\]\\]/g, "\\$&")
			.replace(/\*/g, ".*");

		const regex = new RegExp(
			`^${regexPattern}$|^${regexPattern}/|/${regexPattern}$|/${regexPattern}/`,
		);
		const relativePath = path.relative(cwd, targetPath);

		return (
			regex.test(targetPath) ||
			regex.test(relativePath) ||
			targetPath.includes(resolvedPattern) ||
			relativePath.includes(resolvedPattern)
		);
	}

	pi.on("session_start", async (_event, ctx) => {
		const globalRulesPath = path.join(
			os.homedir(),
			".pi",
			"agent",
			"damage-control-rules.yaml",
		);
		const localRulesPath = path.join(ctx.cwd, ".pi", "damage-control-rules.yaml");
		let loadedRules: Partial<Rules> = {};

		try {
			if (fs.existsSync(globalRulesPath)) {
				const content = fs.readFileSync(globalRulesPath, "utf8");
				loadedRules = yamlParse(content) as Partial<Rules>;
			}

			if (fs.existsSync(localRulesPath)) {
				const content = fs.readFileSync(localRulesPath, "utf8");
				const localRules = yamlParse(content) as Partial<Rules>;
				loadedRules = {
					...loadedRules,
					...localRules,
					bashToolPatterns:
						localRules.bashToolPatterns ?? loadedRules.bashToolPatterns,
					zeroAccessPaths:
						localRules.zeroAccessPaths ?? loadedRules.zeroAccessPaths,
					readOnlyPaths:
						localRules.readOnlyPaths ?? loadedRules.readOnlyPaths,
					noDeletePaths:
						localRules.noDeletePaths ?? loadedRules.noDeletePaths,
				};
			}

			rules = {
				bashToolPatterns: loadedRules.bashToolPatterns || [],
				zeroAccessPaths: loadedRules.zeroAccessPaths || [],
				readOnlyPaths: loadedRules.readOnlyPaths || [],
				noDeletePaths: loadedRules.noDeletePaths || [],
			};

			const totalRules =
				rules.bashToolPatterns.length +
				rules.zeroAccessPaths.length +
				rules.readOnlyPaths.length +
				rules.noDeletePaths.length;

			if (totalRules === 0) {
				ctx.ui.notify("🛡️ Damage-Control: No rules found");
			}
		} catch (err) {
			ctx.ui.notify(
				`🛡️ Damage-Control: Failed to load rules: ${err instanceof Error ? err.message : String(err)}`,
			);
		}

		ctx.ui.setStatus(
			`🛡️ Damage-Control Active: ${rules.bashToolPatterns.length + rules.zeroAccessPaths.length + rules.readOnlyPaths.length + rules.noDeletePaths.length} Rules`,
		);
	});

	pi.on("tool_call", async (event, ctx) => {
		let violationReason: string | null = null;
		let shouldAsk = false;

		const checkPaths = (pathsToCheck: string[]) => {
			for (const p of pathsToCheck) {
				const resolved = resolvePath(p, ctx.cwd);
				for (const zap of rules.zeroAccessPaths) {
					if (isPathMatch(resolved, zap, ctx.cwd)) {
						return `Access to zero-access path restricted: ${zap}`;
					}
				}
			}
			return null;
		};

		const inputPaths: string[] = [];
		if (
			isToolCallEventType("read", event) ||
			isToolCallEventType("write", event) ||
			isToolCallEventType("edit", event)
		) {
			inputPaths.push(event.input.path);
		} else if (
			isToolCallEventType("grep", event) ||
			isToolCallEventType("find", event) ||
			isToolCallEventType("ls", event)
		) {
			inputPaths.push(event.input.path || ".");
		}

		if (isToolCallEventType("grep", event) && event.input.glob) {
			for (const zap of rules.zeroAccessPaths) {
				if (
					event.input.glob.includes(zap) ||
					isPathMatch(event.input.glob, zap, ctx.cwd)
				) {
					violationReason = `Glob matches zero-access path: ${zap}`;
					break;
				}
			}
		}

		if (!violationReason) {
			violationReason = checkPaths(inputPaths);
		}

		if (!violationReason && isToolCallEventType("bash", event)) {
			const command = event.input.command;

			// Parse the shell command properly using shlex
			const parsedCommands = parseShellCommand(command);

			// Check each subcommand against patterns
			for (const parsed of parsedCommands) {
				for (const rule of rules.bashToolPatterns) {
					if (matchesCommandRule(parsed, rule.pattern)) {
						violationReason = rule.reason;
						shouldAsk = !!rule.ask;
						break;
					}
				}

				if (violationReason) break;
			}

			// Check path references in command arguments
			if (!violationReason) {
				for (const zap of rules.zeroAccessPaths) {
					const escapedZap = zap.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
					const regex = new RegExp(`(^|[^\\w])${escapedZap}($|[^\\w])`);
					if (regex.test(command)) {
						violationReason = `Bash command references zero-access path: ${zap}`;
						break;
					}
				}
			}

			// Check for delete/move operations on protected paths
			if (!violationReason) {
				for (const ndp of rules.noDeletePaths) {
					const isDeleteCommand = /\brm\b/.test(command) || /\bmv\b/.test(command);
					if (isDeleteCommand) {
						const escapedNdp = ndp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
						const regex = new RegExp(`(^|[^\\w])${escapedNdp}($|[^\\w])`);
						if (regex.test(command)) {
							violationReason = `Bash command attempts to delete/move protected path: ${ndp}`;
							break;
						}
					}
				}
			}
		} else if (
			!violationReason &&
			(isToolCallEventType("write", event) || isToolCallEventType("edit", event))
		) {
			for (const p of inputPaths) {
				const resolved = resolvePath(p, ctx.cwd);
				for (const rop of rules.readOnlyPaths) {
					if (isPathMatch(resolved, rop, ctx.cwd)) {
						violationReason = `Modification of read-only path restricted: ${rop}`;
						break;
					}
				}
			}
		}

		if (violationReason) {
			if (shouldAsk) {
				const confirmed = await ctx.ui.confirm(
					"🛡️ Damage-Control Confirmation",
					`Dangerous command detected: ${violationReason}\n\nCommand: ${isToolCallEventType("bash", event) ? event.input.command : JSON.stringify(event.input)}\n\nDo you want to proceed?`,
					{ timeout: 30000 },
				);

				if (!confirmed) {
					ctx.ui.setStatus(
						`⚠️ Last Violation Blocked: ${violationReason.slice(0, 30)}...`,
					);
					pi.appendEntry("damage-control-log", {
						tool: event.toolName,
						input: event.input,
						rule: violationReason,
						action: "blocked_by_user",
					});
					ctx.abort();
					return {
						block: true,
						reason: `🛑 BLOCKED by Damage-Control: ${violationReason} (User denied)\n\nDO NOT attempt to work around this restriction. DO NOT retry with alternative commands, paths, or approaches that achieve the same result. Report this block to the user exactly as stated and ask how they would like to proceed.`,
					};
				} else {
					pi.appendEntry("damage-control-log", {
						tool: event.toolName,
						input: event.input,
						rule: violationReason,
						action: "confirmed_by_user",
					});
					return { block: false };
				}
			} else {
				ctx.ui.notify(
					`🛑 Damage-Control: Blocked ${event.toolName} due to ${violationReason}`,
				);
				ctx.ui.setStatus(
					`⚠️ Last Violation: ${violationReason.slice(0, 30)}...`,
				);
				pi.appendEntry("damage-control-log", {
					tool: event.toolName,
					input: event.input,
					rule: violationReason,
					action: "blocked",
				});
				ctx.abort();
				return {
					block: true,
					reason: `🛑 BLOCKED by Damage-Control: ${violationReason}\n\nDO NOT attempt to work around this restriction. DO NOT retry with alternative commands, paths, or approaches that achieve the same result. Report this block to the user exactly as stated and ask how they would like to proceed.`,
				};
			}
		}

		return { block: false };
	});
}
