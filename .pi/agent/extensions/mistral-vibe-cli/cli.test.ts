import { expect, test } from "bun:test";
import { buildVibeArgs, TOOL_NONE, vibeEnv } from "./cli.ts";

test("Vibe runs without native tools", () => {
	const args = buildVibeArgs();
	expect(args).toEqual(["-p", "--legacy-harness", "--enabled-tools", TOOL_NONE, "--output", "json", "--max-turns", "1"]);
	expect(args).not.toContain("--auto-approve");
	expect(args).not.toContain("--yolo");
});

test("Pi's GLM model ID selects Vibe's configured alias", () => {
	expect(vibeEnv("glm-5.3").VIBE_ACTIVE_MODEL).toBe("glm-5-3");
	expect(vibeEnv("default").VIBE_ACTIVE_MODEL).toBeUndefined();
});
