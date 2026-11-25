import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatSkillsForPrompt, type ExtensionAPI, type ExtensionContext, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { runCoderChild } from "#capability-coder";
import { executeCapability } from "#capability-runner";
import { coderSession, resolveCapabilitySkills, stripSkillCatalog } from "#capability-snapshot";
import type { CapabilityDef } from "#capability-types";

let directory: string;
let skillPath: string;
const skillText = "Follow the selected skill's test instructions.";
const getCommands = () => [
	{ name: "skill:coding", source: "skill" as const, sourceInfo: { path: skillPath, source: "test", scope: "temporary" as const, origin: "top-level" as const } },
	{ name: "skill:imposter", source: "extension" as const, sourceInfo: { path: skillPath, source: "test", scope: "temporary" as const, origin: "top-level" as const } },
];

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "capability-skills-"));
	skillPath = join(directory, "coding.md");
	writeFileSync(skillPath, skillText);
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

function parentCatalog(): string {
	return `<skills>\n${formatSkillsForPrompt([{ name: "unselected", description: "An unselected skill", filePath: "/unselected/SKILL.md", baseDir: "/unselected", source: "test", disableModelInvocation: false }]).trim()}\n</skills>`;
}

test("selection only resolves names from parent skill metadata", () => {
	expect(resolveCapabilitySkills({ getCommands: () => { throw new Error("No discovery needed"); } })).toEqual([]);
	expect(resolveCapabilitySkills({ getCommands }, ["coding", "coding"])).toEqual([{ name: "coding", filePath: skillPath }]);
	for (const unknown of ["imposter", "missing", skillPath]) {
		expect(() => resolveCapabilitySkills({ getCommands }, [unknown])).toThrow("Unknown skill");
	}
});

test("coder strips Pi catalogs from prompt, transcript, and compaction state", () => {
	const catalog = parentCatalog();
	const prompt = `Parent rules\n\n${catalog}\n\n<cwd>\n/project\n</cwd>`;
	const childPrompt = stripSkillCatalog(prompt);
	expect(childPrompt).toContain("Parent rules");
	expect(childPrompt).toContain("<cwd>\n/project\n</cwd>");
	expect(childPrompt).not.toContain("<skills>");
	const timestamp = new Date().toISOString();
	const branch: SessionEntry[] = [
		{ type: "message", id: "rules", parentId: null, timestamp,
			message: { role: "system", content: prompt, timestamp: 1, sections: { skills: catalog, rules: "Keep these rules" } } },
		{ type: "compaction", id: "summary", parentId: "rules", timestamp, firstKeptEntryId: "rules", tokensBefore: 100,
			summary: "Keep this summary", systemMessage: { role: "system", content: prompt, timestamp: 1, sections: { skills: catalog } } },
	];
	const childSession = coderSession(branch, directory);
	expect(childSession).not.toContain("unselected");
	expect(childSession).toContain("Keep these rules");
	expect(childSession).toContain("Keep this summary");
	expect(JSON.stringify(branch)).toContain("unselected");
});

for (const selected of [false, true]) {
	test(`coder RPC uses only requested skill paths, selected=${selected}`, async () => {
		const executable = join(directory, "fake-pi");
		writeFileSync(executable, `#!/usr/bin/env node
const fs = require("node:fs");
const argv = process.argv.slice(2);
fs.writeFileSync("argv.json", JSON.stringify(argv));
const emit = value => process.stdout.write(JSON.stringify(value) + "\\n");
const hooks = new Map();
(async () => {
  const preflight = await import(argv[argv.indexOf("--extension") + 1]);
  preflight.default({
    on: (event, handler) => hooks.set(event, handler),
    getActiveTools: () => argv[argv.indexOf("--tools") + 1].split(","),
  });
  hooks.get("session_start")();
  const skills = [{ filePath: "/extra/extension-skill/SKILL.md" }, { filePath: ${JSON.stringify(skillPath)} }];
  const event = { systemPromptOptions: { skills } };
  hooks.get("before_agent_start")(event);
  fs.writeFileSync("skills.json", JSON.stringify(event.systemPromptOptions.skills));
  require("node:readline").createInterface({ input: process.stdin }).on("line", (line) => {
    const command = JSON.parse(line);
    const data = command.type === "get_state" ? { model: { provider: "test", id: "model" } } : { disposition: "started" };
    emit({ type: "response", command: command.type, id: command.id, success: true, data });
    if (command.type !== "prompt") return;
    emit({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Done" }], stopReason: "stop" } });
    emit({ type: "agent_settled" });
  });
})().catch(error => { console.error(error); process.exit(1); });
`, { mode: 0o700 });
		const skillPaths = selected ? resolveCapabilitySkills({ getCommands }, ["coding"]).map(skill => skill.filePath) : undefined;
		await runCoderChild({ cwd: directory, model: "test/model", thinking: "low", task: "Check scope", directory,
			session: coderSession([], directory), systemPrompt: "Keep rules", signal: new AbortController().signal, executable, skillPaths });
		const args: string[] = JSON.parse(readFileSync(join(directory, "argv.json"), "utf8"));
		expect(args).toContain("--no-skills");
		expect(args).toContain("--no-mcp");
		expect(args.filter(arg => arg === "--skill")).toHaveLength(selected ? 1 : 0);
		if (selected) expect(args[args.indexOf("--skill") + 1]).toBe(skillPath);
		expect(JSON.parse(readFileSync(join(directory, "skills.json"), "utf8"))).toEqual(selected ? [{ filePath: skillPath }] : []);
	});
}

for (const toolName of ["reasoning_coach", "patch_reviewer"]) {
	test(`${toolName} sends selected instructions only and reserves budget`, async () => {
		const reports: string[] = [];
		const budgets: number[] = [];
		const model = { provider: "test", id: "model", contextWindow: 100000, maxTokens: 4096 };
		const ctx = {
			cwd: directory, sessionManager: { getSessionId: () => "" }, getSystemPrompt: parentCatalog,
			modelRegistry: {
				find: () => model,
				getApiKeyAndHeaders: () => Promise.resolve({ ok: true, apiKey: "fixture" }),
				getRegisteredProviderConfig: () => undefined,
				getProvider: () => ({ stream(_model: unknown, transcript: unknown) {
					reports.push(JSON.stringify(transcript));
					return { async *[Symbol.asyncIterator]() {}, result: async () => ({ stopReason: "stop", content: [{ type: "text", text: "Done" }] }) };
				} }),
			},
		} as unknown as ExtensionContext;
		const def = { model: "test/model", toolName, label: toolName, systemPrompt: "Independent helper rules", maxFiles: 0 } as CapabilityDef;
		const update = (value: { details?: unknown }) => {
			const details = value.details as { inputBudgetTokens?: number };
			if (details?.inputBudgetTokens) budgets.push(details.inputBudgetTokens);
		};
		const input = { task: "Check scope" };
		const base = await executeCapability({} as ExtensionAPI, def, input, undefined, update, ctx);
		const selected = await executeCapability({} as ExtensionAPI, def, input, undefined, update, ctx, resolveCapabilitySkills({ getCommands }, ["coding"]));
		expect(base.details.status).toBe("done");
		expect(selected.details.status).toBe("done");
		expect(reports).toHaveLength(2);
		expect(reports[0]).toContain("Independent helper rules");
		expect(reports[0]).not.toContain(skillText);
		expect(reports[1]).toContain(skillText);
		expect(reports.join("\n")).not.toContain("available_skills");
		expect(budgets[1]).toBeLessThan(budgets[0]);
	});
}
