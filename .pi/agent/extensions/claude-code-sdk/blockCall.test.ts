import { describe, expect, test } from "bun:test";
import { containsBlockFence, parseBlockToolCalls, parseYamlCall, renderBlockCall } from "./blockCall.ts";
import { parseToolCalls } from "./prompt.ts";

describe("parseYamlCall", () => {
	test("parses name plus arguments mapping", () => {
		const call = parseYamlCall('name: bash\narguments:\n  command: echo hi\n');
		expect(call).toEqual({ name: "bash", arguments: { command: "echo hi" } });
	});

	test("block scalar keeps raw multiline shell with quotes and $()", () => {
		const body = 'name: bash\narguments:\n  command: |\n    STS=$(aws sts get-caller-identity --query Arn --output text 2>&1)\n    echo "sts=$STS"\n  timeout: 240\n';
		const call = parseYamlCall(body);
		expect(call?.name).toBe("bash");
		expect(call?.arguments.command).toBe(
			'STS=$(aws sts get-caller-identity --query Arn --output text 2>&1)\necho "sts=$STS"\n',
		);
		expect(call?.arguments.timeout).toBe(240);
	});

	test("nested lists of objects survive (edit-style arguments)", () => {
		const body =
			"name: edit\narguments:\n  path: src/a.ts\n  edits:\n    - oldText: |\n        a\n        b\n      newText: c\n";
		const call = parseYamlCall(body);
		expect(call?.arguments.edits).toEqual([{ oldText: "a\nb\n", newText: "c" }]);
	});

	test("invalid YAML returns undefined", () => {
		expect(parseYamlCall("name: [")).toBeUndefined();
		expect(parseYamlCall("arguments:\n  command: x")).toBeUndefined();
		expect(parseYamlCall("name: bash")).toBeUndefined();
		expect(parseYamlCall("name: bash\narguments: []")).toBeUndefined();
	});
});

describe("parseBlockToolCalls", () => {
	test("extracts multiple fenced blocks in order", () => {
		const reply = [
			"prose before",
			"```pi-tool-call",
			"name: read",
			"arguments:",
			"  path: a.ts",
			"```",
			"```pi-tool-call",
			"name: read",
			"arguments:",
			"  path: b.ts",
			"```",
			"prose after",
		].join("\n");
		const calls = parseBlockToolCalls(reply);
		expect(calls.map((c) => c.arguments.path)).toEqual(["a.ts", "b.ts"]);
	});

	test("skips malformed blocks but keeps valid ones", () => {
		const reply = "```pi-tool-call\nname: [broken\n```\n```pi-tool-call\nname: read\narguments:\n  path: ok.ts\n```";
		const calls = parseBlockToolCalls(reply);
		expect(calls).toEqual([{ name: "read", arguments: { path: "ok.ts" } }]);
	});

	test("ignores other fenced languages", () => {
		const reply = "```bash\necho hi\n```";
		expect(parseBlockToolCalls(reply)).toEqual([]);
	});

	test("containsBlockFence detects marker even when malformed", () => {
		expect(containsBlockFence("```pi-tool-call\nname: [")).toBe(true);
		expect(containsBlockFence("plain text")).toBe(false);
	});
});

describe("renderBlockCall", () => {
	test("roundtrips through parseYamlCall", () => {
		const args = {
			command: 'echo "raw $x"\nsecond line',
			timeout: 240,
			edits: [{ oldText: "a\nb", newText: "c" }],
		};
		const rendered = renderBlockCall("bash", args);
		expect(rendered.startsWith("```pi-tool-call\n")).toBe(true);
		expect(rendered.endsWith("```")).toBe(true);
		const parsed = parseYamlCall(rendered.slice("```pi-tool-call\n".length, -3));
		expect(parsed).toEqual({ name: "bash", arguments: args });
	});

	test("multiline values render as block scalars without escapes", () => {
		const rendered = renderBlockCall("bash", { command: "echo hi\nx=1" });
		expect(rendered).toContain("command: |");
		expect(rendered).not.toContain("\\n");
	});
});

describe("parseToolCalls (combined protocol)", () => {
	test("fenced YAML and legacy tags both parse", () => {
		const reply = [
			"```pi-tool-call",
			"name: read",
			"arguments:",
			"  path: new.ts",
			"```",
			'<pi_tool_call>{"name":"read","arguments":{"path":"old.ts"}}</pi_tool_call>',
		].join("\n");
		const calls = parseToolCalls(reply);
		expect(calls.map((c) => c.arguments.path)).toEqual(["new.ts", "old.ts"]);
	});

	test("plain text yields no calls", () => {
		expect(parseToolCalls("just an answer")).toEqual([]);
	});
});
