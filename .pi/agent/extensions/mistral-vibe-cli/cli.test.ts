import { expect, test } from "bun:test";
import { buildVibeArgs, TOOL_NONE, vibeEnv } from "./cli.ts";

function withLegacyHarnessOverride(value: string | undefined, run: () => void) {
	const prev = process.env.MISTRAL_VIBE_CLI_LEGACY_HARNESS;
	if (value === undefined) delete process.env.MISTRAL_VIBE_CLI_LEGACY_HARNESS;
	else process.env.MISTRAL_VIBE_CLI_LEGACY_HARNESS = value;
	try {
		run();
	} finally {
		if (prev === undefined) delete process.env.MISTRAL_VIBE_CLI_LEGACY_HARNESS;
		else process.env.MISTRAL_VIBE_CLI_LEGACY_HARNESS = prev;
	}
}

test("Vibe runs without native tools", () => {
	withLegacyHarnessOverride("on", () => {
		const args = buildVibeArgs();
		expect(args).toEqual([
			"-p",
			"--legacy-harness",
			"--enabled-tools",
			TOOL_NONE,
			"--output",
			"json",
			"--max-turns",
			"1",
		]);
	});
	expect(buildVibeArgs()).not.toContain("--auto-approve");
	expect(buildVibeArgs()).not.toContain("--yolo");
});

test("Old Vibe CLIs drop the legacy-harness pin", () => {
	withLegacyHarnessOverride("off", () => {
		const args = buildVibeArgs();
		expect(args).toEqual(["-p", "--enabled-tools", TOOL_NONE, "--output", "json", "--max-turns", "1"]);
	});
});

test("Pi's GLM model ID selects Vibe's configured alias", () => {
	expect(vibeEnv("glm-5.3").VIBE_ACTIVE_MODEL).toBe("glm-5-3");
	expect(vibeEnv("default").VIBE_ACTIVE_MODEL).toBeUndefined();
});
