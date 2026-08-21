/**
 * Plain-English rewrite of the last assistant message (Claudish-style).
 * Original stays in transcript; rewrite is a display-only custom entry.
 *
 *   /plain                 rewrite with current style (default: plain)
 *   /plain tldr|5y|plain   one-shot style
 *   /plain style <name>    set default style
 *   /plain model <ref>     set provider/id override, or "default"
 *   /plain status|help     show config / usage
 *
 * Model defaults to the session model. Override later via /plain model.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Model, UserMessage } from "@earendil-works/pi-ai";
import {
	BorderedLoader,
	type ExtensionAPI,
	type ExtensionCommandContext,
	getAgentDir,
	getMarkdownTheme,
} from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { Box, Markdown, Text } from "@earendil-works/pi-tui";

type Style = "plain" | "tldr" | "5y";
type PlainConfig = { style: Style; model: string };
type PlainEntryData = {
	style: Style;
	rewrite: string;
	modelLabel: string;
	timestamp: number;
};

const CONFIG_NAME = "plain-english.json";
const ENTRY_TYPE = "plain-english";
const MIN_CHARS = 80;
const DEFAULT: PlainConfig = { style: "plain", model: "" };

const STYLE_LABEL: Record<Style, string> = {
	plain: "In plain language",
	tldr: "TL;DR",
	"5y": "Like you're five",
};

const PROMPTS: Record<Style, string> = {
	plain:
		"You rewrite the assistant's message into much simpler, plain language. " +
		"Write the rewrite in the same language as the message you are rewriting. " +
		"Keep every fact, name, number, command, and file path. Use short sentences and everyday words. " +
		"Leave fenced code blocks unchanged. Output ONLY the rewritten message with no preamble, labels, or commentary.",
	tldr:
		"You rewrite the assistant's message as a SHORT summary in simple, plain language. " +
		"This is a simplification, NOT a translation: it must be clearly shorter than the original — aim for half its length or less. " +
		"Keep the key facts, decisions, numbers, commands, and file paths; drop repetitions, hedges, and secondary detail. " +
		"Keep technical terms and identifiers in their original form. Omit fenced code blocks. " +
		"Write the rewrite in the same language as the message you are rewriting. " +
		"Output ONLY the rewritten message with no preamble, labels, or commentary.",
	"5y":
		"You rewrite the assistant's message as if explaining it to a five-year-old: very simple words, short sentences, " +
		"a friendly tone, and simple comparisons for hard ideas. Keep every important fact, name, number, command, and file path accurate. " +
		"Keep technical terms and identifiers in their original form. Leave fenced code blocks unchanged. " +
		"Write the rewrite in the same language as the message you are rewriting. " +
		"Output ONLY the rewritten message with no preamble, labels, or commentary.",
};

const TOP = ["tldr", "5y", "plain", "style", "model", "status", "help"] as const;
const STYLES = ["plain", "tldr", "5y"] as const;

function isStyle(v: string): v is Style {
	return v === "plain" || v === "tldr" || v === "5y";
}

function configPath(): string {
	return join(getAgentDir(), "extensions", CONFIG_NAME);
}

function readConfig(): PlainConfig {
	const path = configPath();
	if (!existsSync(path)) return { ...DEFAULT };
	try {
		const p = JSON.parse(readFileSync(path, "utf-8")) as Partial<PlainConfig>;
		return {
			style: isStyle(p.style ?? "") ? p.style! : DEFAULT.style,
			model: typeof p.model === "string" ? p.model.trim() : DEFAULT.model,
		};
	} catch {
		return { ...DEFAULT };
	}
}

function writeConfig(config: PlainConfig): void {
	writeFileSync(configPath(), `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}

function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const part of content) {
		if (!part || typeof part !== "object") continue;
		const b = part as { type?: string; text?: string };
		if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
	}
	return parts.join("\n");
}

function lastTurn(ctx: ExtensionCommandContext): {
	assistant?: string;
	user?: string;
	stopReason?: string;
} {
	const branch = ctx.sessionManager.getBranch();
	let assistant: string | undefined;
	let user: string | undefined;
	let stopReason: string | undefined;

	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry.type !== "message") continue;
		const msg = entry.message as { role?: string; content?: unknown; stopReason?: string };
		if (!msg.role) continue;
		if (!assistant && msg.role === "assistant") {
			const text = extractText(msg.content).trim();
			if (text) {
				assistant = text;
				stopReason = msg.stopReason;
			}
			continue;
		}
		if (assistant && !user && msg.role === "user") {
			const text = extractText(msg.content).trim();
			if (text) user = text;
			break;
		}
	}
	return { assistant, user, stopReason };
}

function parseModelRef(ref: string): { provider: string; id: string } | undefined {
	const t = ref.trim();
	const i = t.indexOf("/");
	if (i <= 0 || i === t.length - 1) return undefined;
	return { provider: t.slice(0, i), id: t.slice(i + 1) };
}

function modelLabel(m: Model): string {
	return `${m.provider}/${m.id}`;
}

function resolveModel(ctx: ExtensionCommandContext, config: PlainConfig): Model | undefined {
	if (!config.model) return ctx.model ?? undefined;
	const parsed = parseModelRef(config.model);
	if (!parsed) return undefined;
	return ctx.modelRegistry.find(parsed.provider, parsed.id);
}

function systemPrompt(style: Style, userQuestion?: string): string {
	let prompt = PROMPTS[style];
	if (userQuestion) {
		const clipped = userQuestion.length > 1500 ? `${userQuestion.slice(0, 1500)}…` : userQuestion;
		prompt +=
			`\n\nFor context, the user asked the assistant: "${clipped.replace(/"/g, "'")}". ` +
			"Use this only to understand the message. Do NOT rewrite, answer, or repeat the user's question — " +
			"rewrite only the assistant's message that follows.";
	}
	return prompt;
}

function filterCompletions(values: readonly string[], prefix: string): AutocompleteItem[] | null {
	const items = values.filter((v) => v.startsWith(prefix)).map((v) => ({ value: v, label: v }));
	return items.length > 0 ? items : null;
}

function statusLines(config: PlainConfig, session?: Model): string {
	const model = config.model
		? `${config.model} (override)`
		: session
			? `${modelLabel(session)} (session)`
			: "(none)";
	return [
		"plain-english",
		`  style   ${config.style}`,
		`  model   ${model}`,
		`  config  ${configPath()}`,
		"",
		"  /plain [plain|tldr|5y]",
		"  /plain style <plain|tldr|5y>",
		"  /plain model <provider/id|default>",
		"  /plain status | help",
	].join("\n");
}

export default function plainEnglishExtension(pi: ExtensionAPI) {
	pi.registerEntryRenderer<PlainEntryData>(ENTRY_TYPE, (entry, { expanded }, theme) => {
		const data = entry.data ?? {
			style: "plain" as Style,
			rewrite: "(empty)",
			modelLabel: "?",
			timestamp: Date.now(),
		};
		const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
		box.addChild(
			new Text(
				theme.fg("accent", theme.bold(`${STYLE_LABEL[data.style] ?? "Plain"} · ${data.modelLabel}`)),
				0,
				0,
			),
		);
		box.addChild(new Markdown(data.rewrite, 0, 0, getMarkdownTheme()));
		if (expanded) {
			box.addChild(new Text(theme.fg("dim", new Date(data.timestamp).toLocaleString()), 0, 0));
		}
		return box;
	});

	const rewrite = async (ctx: ExtensionCommandContext, style: Style, config: PlainConfig) => {
		const { assistant, user, stopReason } = lastTurn(ctx);
		if (!assistant) {
			ctx.ui.notify("No assistant message to rewrite", "warning");
			return;
		}
		if (stopReason && stopReason !== "stop") {
			ctx.ui.notify(`Last assistant message incomplete (${stopReason})`, "warning");
			return;
		}
		const prose = assistant.replace(/```[\s\S]*?```/g, "").trim().length;
		if (prose < MIN_CHARS) {
			ctx.ui.notify(`Message too short to rewrite (<${MIN_CHARS} prose chars)`, "info");
			return;
		}

		const model = resolveModel(ctx, config);
		if (!model) {
			ctx.ui.notify(
				config.model ? `Rewrite model not found: ${config.model}` : "No model selected",
				"error",
			);
			return;
		}
		if (!ctx.modelRegistry.hasConfiguredAuth(model)) {
			ctx.ui.notify(`No auth for ${modelLabel(model)}`, "error");
			return;
		}

		const userMessage: UserMessage = {
			role: "user",
			content: [{ type: "text", text: assistant }],
			timestamp: Date.now(),
		};

		const complete = async (signal?: AbortSignal): Promise<string | null> => {
			const response = await ctx.modelRegistry.complete(
				model,
				{ systemPrompt: systemPrompt(style, user), messages: [userMessage] },
				{ signal, temperature: 0.3 },
			);
			if (response.stopReason === "aborted") return null;
			const text = response.content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("\n")
				.trim();
			return text || null;
		};

		let text: string | null = null;
		if (ctx.mode === "tui" && ctx.hasUI) {
			text = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
				const loader = new BorderedLoader(
					tui,
					theme,
					`Rewriting (${STYLE_LABEL[style]}) with ${modelLabel(model)}...`,
				);
				loader.onAbort = () => done(null);
				complete(loader.signal)
					.then(done)
					.catch((err: unknown) => {
						const msg = err instanceof Error ? err.message : String(err);
						ctx.ui.notify(`Rewrite failed: ${msg}`, "error");
						done(null);
					});
				return loader;
			});
		} else {
			ctx.ui.notify(`Rewriting with ${modelLabel(model)}...`, "info");
			try {
				text = await complete();
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				ctx.ui.notify(`Rewrite failed: ${msg}`, "error");
				return;
			}
		}

		if (text === null) {
			ctx.ui.notify("Rewrite cancelled", "info");
			return;
		}

		pi.appendEntry<PlainEntryData>(ENTRY_TYPE, {
			style,
			rewrite: text,
			modelLabel: modelLabel(model),
			timestamp: Date.now(),
		});
		ctx.ui.notify(`${STYLE_LABEL[style]} ready`, "info");
	};

	pi.registerCommand("plain", {
		description: "Plain-English rewrite of last assistant message (tldr|5y|style|model|status)",
		getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
			const parts = prefix.split(/\s+/);
			if (parts.length <= 1) return filterCompletions(TOP, parts[0] ?? "");
			if (parts[0] === "style") return filterCompletions(STYLES, parts.slice(1).join(" "));
			if (parts[0] === "model") return filterCompletions(["default"], parts.slice(1).join(" "));
			return null;
		},
		handler: async (args, ctx) => {
			const config = readConfig();
			const raw = args.trim();
			if (!raw) {
				await rewrite(ctx, config.style, config);
				return;
			}

			const [cmd, ...restParts] = raw.split(/\s+/);
			const rest = restParts.join(" ").trim();

			if (cmd === "status" || cmd === "help" || cmd === "?") {
				ctx.ui.notify(statusLines(config, ctx.model ?? undefined), "info");
				return;
			}

			if (cmd === "style") {
				if (!rest) {
					ctx.ui.notify(`style: ${config.style} (plain|tldr|5y)`, "info");
					return;
				}
				if (!isStyle(rest)) {
					ctx.ui.notify(`Unknown style "${rest}". Use plain|tldr|5y.`, "error");
					return;
				}
				config.style = rest;
				writeConfig(config);
				ctx.ui.notify(`plain style → ${rest}`, "info");
				return;
			}

			if (cmd === "model") {
				if (!rest || rest === "default" || rest === "session" || rest === "clear") {
					config.model = "";
					writeConfig(config);
					const session = ctx.model ? modelLabel(ctx.model) : "(none)";
					ctx.ui.notify(`plain model → session default (${session})`, "info");
					return;
				}
				const parsed = parseModelRef(rest);
				if (!parsed) {
					ctx.ui.notify('Model must be "provider/id" (or "default")', "error");
					return;
				}
				const found = ctx.modelRegistry.find(parsed.provider, parsed.id);
				if (!found) {
					ctx.ui.notify(`Model not found: ${rest}`, "error");
					return;
				}
				if (!ctx.modelRegistry.hasConfiguredAuth(found)) {
					ctx.ui.notify(`No auth for ${rest}`, "warning");
				}
				config.model = `${parsed.provider}/${parsed.id}`;
				writeConfig(config);
				ctx.ui.notify(`plain model → ${config.model}`, "info");
				return;
			}

			if (isStyle(cmd) && !rest) {
				await rewrite(ctx, cmd, config);
				return;
			}

			ctx.ui.notify(
				`Unknown args "${raw}". Try /plain, /plain tldr|5y|plain, /plain style, /plain model, /plain status`,
				"error",
			);
		},
	});
}
