import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeProjectDir, deleteClaudeSessionFile } from "./sessions.ts";

const prevConfig = process.env.CLAUDE_CONFIG_DIR;

afterEach(() => {
	if (prevConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR;
	else process.env.CLAUDE_CONFIG_DIR = prevConfig;
});

describe("deleteClaudeSessionFile", () => {
	test("deletes the transcript for the munged project dir", async () => {
		const root = await mkdtemp(join(tmpdir(), "claude-del-"));
		process.env.CLAUDE_CONFIG_DIR = root;
		const cwd = "/Users/x/CODES/my-pi";
		const uuid = "11111111-2222-3333-4444-555555555555";
		expect(claudeProjectDir(cwd)).toBe(join(root, "projects", "-Users-x-CODES-my-pi"));
		await mkdir(claudeProjectDir(cwd), { recursive: true });
		await writeFile(join(claudeProjectDir(cwd), `${uuid}.jsonl`), "{}\n");
		await writeFile(join(claudeProjectDir(cwd), "memory"), "keep\n");

		const removed = await deleteClaudeSessionFile(uuid, cwd);
		expect(removed).toBe(join(claudeProjectDir(cwd), `${uuid}.jsonl`));

		const dir = claudeProjectDir(cwd);
		const { readdirSync, existsSync } = await import("node:fs");
		expect(existsSync(removed!)).toBe(false);
		// sibling files untouched
		expect(readdirSync(dir)).toContain("memory");
		await rm(root, { recursive: true, force: true });
	});

	test("missing file returns undefined without throwing", async () => {
		const root = await mkdtemp(join(tmpdir(), "claude-del-"));
		process.env.CLAUDE_CONFIG_DIR = root;
		const removed = await deleteClaudeSessionFile("99999999-9999-9999-9999-999999999999", "/nowhere");
		expect(removed).toBeUndefined();
		await rm(root, { recursive: true, force: true });
	});
});
