/**
 * Prereqs Extension - Lean version
 *
 * Auto-executes BASH commands, lets agent mark SKILL/AGENT/manual as done.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text, truncateToWidth } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import * as fs from "node:fs";
import * as path from "node:path";

type PrereqType = "bash" | "skill" | "agent" | "text" | "manual";

interface PrereqItem {
    id: number;
    text: string;
    type: PrereqType;
    target: string;
    done: boolean;
    result?: string;
    error?: string;
}

const TYPE_REGEX = /^([A-Z]+):`([^`]+)`(?:\s*-\s*(.+))?$/;

function parseItem(text: string, id: number, checked: boolean): PrereqItem {
    const match = text.match(TYPE_REGEX);
    if (!match) return { id, text, type: "manual", target: "", done: checked };

    const [, typeStr, target, desc] = match;
    const displayText = desc || `${typeStr.toLowerCase()}: ${target}`;

    switch (typeStr.toUpperCase()) {
        case "BASH": return { id, text: displayText, type: "bash", target, done: checked };
        case "SKILL": return { id, text: displayText, type: "skill", target, done: checked };
        case "AGENT": return { id, text: displayText, type: "agent", target, done: checked };
        case "TEXT": return { id, text: displayText, type: "text", target, done: checked };
        default: return { id, text, type: "manual", target: "", done: checked };
    }
}

function parseMarkdown(content: string): PrereqItem[] {
    const items: PrereqItem[] = [];
    let id = 1;
    for (const line of content.split("\n")) {
        const match = line.match(/^[\s]*[-*]\s+\[([ xX])\]\s+(.+)$/);
        if (match) items.push(parseItem(match[2].trim(), id++, match[1].toLowerCase() === "x"));
    }
    return items;
}

let allDoneNotified = false;

function buildContext(items: PrereqItem[]): string {
    const pending = items.filter(i => !i.done);
    const done = items.filter(i => i.done && !i.error);

    // When all done, show minimal summary
    if (pending.length === 0 && done.length > 0) {
        if (!allDoneNotified) {
            allDoneNotified = true;
            return `✓ All ${done.length} prerequisite(s) completed. Proceeding with task.`;
        }
        return ""; // Skip if already notified
    }

    const lines = ["# Prerequisites Context", ""];

    if (pending.length) {
        lines.push("## ⚠️ PENDING - Complete these before proceeding:");
        lines.push("");
        for (const i of pending) {
            if (i.type === "skill") {
                lines.push(`- **SKILL**: Load with \`/skill:${i.target}\``);
                lines.push(`  Then mark done: \`prereqs check id:${i.id}\``);
            } else if (i.type === "agent") {
                lines.push(`- **AGENT**: Run \`agents_discover\` tool`);
                lines.push(`  Then mark done: \`prereqs check id:${i.id}\``);
            } else if (i.type === "bash") {
                lines.push(`- **BASH**: \`${i.target}\``);
            } else {
                lines.push(`- ${i.text}`);
                lines.push(`  Mark done: \`prereqs check id:${i.id}\``);
            }
            lines.push("");
        }
        lines.push("---");
        lines.push("");
    }

    if (done.length) {
        lines.push("## ✓ Completed:");
        for (const i of done) lines.push(`- ${i.text}`);
        lines.push("");
    }

    return lines.join("\n");
}

export default function (pi: ExtensionAPI) {
    let items: PrereqItem[] = [];
    let filePath: string | undefined;
    let loaded = false;

    const DEFAULT_PREREQS = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../PREREQS.md");

    pi.registerFlag("prereqs", { description: "Path to PREREQS.md", type: "string", default: "" });

    const loadFile = (ctx: ExtensionContext) => {
        const flag = pi.getFlag("--prereqs") as string | undefined;
        filePath = flag ? path.resolve(ctx.cwd, flag) : DEFAULT_PREREQS;
        try {
            items = parseMarkdown(fs.readFileSync(filePath, "utf-8"));
            loaded = true;
        } catch (err: unknown) {
            loaded = false;
            items = [];
            ctx.ui.notify(`prereqs: failed to load ${filePath}: ${err instanceof Error ? err.message : String(err)}`, "error");
        }
    };

    const execBash = async (item: PrereqItem, ctx: ExtensionContext) => {
        try {
            const r = await pi.exec("bash", ["-c", item.target], { cwd: ctx.cwd, timeout: 30000 });
            item.done = true;
            item.result = r.stdout || "(no output)";
            if (r.code !== 0) item.error = `exit ${r.code}`;
        } catch (e) {
            item.done = true;
            item.error = e instanceof Error ? e.message : String(e);
        }
    };

    const checkSkill = (item: PrereqItem, ctx: ExtensionContext) => {
        const entries = ctx.sessionManager.getBranch();
        return entries.some(e =>
            e.type === "message" &&
            e.message.role === "user" &&
            (typeof e.message.content === "string"
                ? e.message.content
                : e.message.content.map(c => c.type === "text" ? c.text : "").join("")
            ).includes(`/skill:${item.target}`)
        );
    };

    const checkAgent = (ctx: ExtensionContext) => {
        const entries = ctx.sessionManager.getBranch();
        return entries.some(e => e.type === "message" && e.message.role === "toolResult" && e.message.toolName === "agents_discover");
    };

    const runAll = async (ctx: ExtensionContext) => {
        for (const item of items.filter(i => !i.done)) {
            if (item.type === "bash") await execBash(item, ctx);
            else if (item.type === "text") { item.done = true; item.result = item.target; }
            else if (item.type === "manual") { item.done = true; item.result = item.text; }
        }
    };

    const showWidget = (ctx: ExtensionContext) => {
        if (!loaded || !items.length) {
            ctx.ui.setWidget("prereqs", undefined);
            return;
        }
        const pending = items.filter(i => !i.done);
        if (pending.length) {
            ctx.ui.setWidget("prereqs", (_t, theme) => ({
                render(w: number) {
                    return [
                        truncateToWidth(theme.fg("warning", "[PREREQS] ") + theme.fg("muted", `${pending.length} pending`), w),
                        ...pending.slice(0, 3).map(i => truncateToWidth(`  ○ #${i.id} ${i.text}`, w)),
                    ];
                },
                invalidate() {},
            }), { placement: "belowEditor" });
        } else {
            ctx.ui.setWidget("prereqs", undefined);
        }
    };

    pi.on("session_start", async (_e, ctx) => { loadFile(ctx); await runAll(ctx); });
    pi.on("session_switch", async (_e, ctx) => { loadFile(ctx); await runAll(ctx); });

    pi.on("tool_result", async (_e, ctx) => {
        for (const item of items.filter(i => !i.done && i.type === "skill")) {
            if (checkSkill(item, ctx)) { item.done = true; item.result = `Skill loaded`; }
        }
        for (const item of items.filter(i => !i.done && i.type === "agent")) {
            if (checkAgent(ctx)) { item.done = true; item.result = `Agents discovered`; }
        }
    });

    pi.registerCommand("prereqs", {
        description: "Show prereqs context",
        handler: async (_a, ctx) => {
            if (!loaded) return { success: false, message: "No prereqs file" };
            showWidget(ctx);
            const pending = items.filter(i => !i.done);
            const contextMsg = buildContext(items);
            const promptMsg = pending.length > 0
                ? `Please complete the ${pending.length} pending prerequisite(s) shown above, then proceed with the task.`
                : "All prerequisites are complete. Please proceed with the task.";
            pi.sendMessage({
                customType: "prereqs",
                content: contextMsg + "\n\n" + promptMsg,
                display: true,
            }, { triggerTurn: true });
            return { success: true, message: "Context added" };
        },
    });

    pi.registerTool({
        name: "prereqs",
        label: "Prereqs",
        description: "list | check id:1 | uncheck id:2 - Example: prereqs check id:1",
        parameters: Type.Object({
            action: StringEnum(["list", "check", "uncheck"] as const),
            id: Type.Optional(Type.Number()),
        }),

        async execute(_id, params, _s, _u, ctx) {
            if (!loaded) return { content: [{ type: "text", text: "No prereqs file" }] };

            switch (params.action) {
                case "list": {
                    const lines = items.map(i => `${i.done ? "✓" : "○"} #${i.id} (${i.type}) ${i.text}${i.error ? ` [${i.error}]` : ""}`);
                    return { content: [{ type: "text", text: lines.join("\n") }] };
                }

                case "check": {
                    if (!params.id) return { content: [{ type: "text", text: "Error: id required" }] };
                    ctx.ui.notify(`prereqs check: looking for id ${params.id}, have ${items.length} items`, "info");
                    const item = items.find(i => i.id === params.id);
                    if (!item) return { content: [{ type: "text", text: `Item #${params.id} not found (have ${items.length} items)` }] };
                    item.done = true;
                    item.error = undefined;
                    if (!item.result) item.result = "Marked done";
                    showWidget(ctx);
                    const remaining = items.filter(i => !i.done).length;
                    ctx.ui.notify(`prereqs check: marked #${params.id} done, ${remaining} remaining`, "info");
                    return { content: [{ type: "text", text: remaining === 0 ? "All done!" : `${remaining} remaining` }] };
                }

                case "uncheck": {
                    if (!params.id) return { content: [{ type: "text", text: "Error: id required" }] };
                    const item = items.find(i => i.id === params.id);
                    if (!item) return { content: [{ type: "text", text: `Item #${params.id} not found` }] };
                    item.done = false;
                    item.result = undefined;
                    showWidget(ctx);
                    return { content: [{ type: "text", text: `Unchecked #${params.id}` }] };
                }
            }
        },

        renderCall(args, theme) {
            return new Text(theme.fg("toolTitle", "prereqs ") + theme.fg("muted", args.action) + (args.id ? ` #${args.id}` : ""), 0, 0);
        },

        renderResult(result, _o, theme) {
            const t = result.content[0];
            return new Text(t?.type === "text" ? t.text : "", 0, 0);
        },
    });
}
