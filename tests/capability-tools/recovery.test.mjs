import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const { default: ts } = await import(new URL(".pi/agent/extensions/node_modules/typescript/lib/typescript.js", root));
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith(".") && context.parentURL?.includes("/capability-tools/")) {
      const url = new URL(specifier, context.parentURL);
      if (!path.extname(url.pathname) && fs.existsSync(fileURLToPath(url) + ".ts")) return next(url.href + ".ts", context);
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith("file:") && url.endsWith(".ts") && !url.includes("/node_modules/")) {
      return { format: "module", shortCircuit: true, source: ts.transpileModule(fs.readFileSync(new URL(url), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText };
    }
    return next(url, context);
  },
});
const capability = name => new URL(`.pi/agent/extensions/capability-tools/${name}.ts`, root);
const { coderSession, repairCoderTranscript } = await import(capability("snapshot"));
const { coderRpc, classifyCoderError, canRetryCoder, CHILD_TOOLS } = await import(capability("coderRpc"));
const sdk = await import(new URL(".pi/agent/extensions/node_modules/@earendil-works/pi-coding-agent/dist/index.js", root));
const { convertResponsesMessages } = await import(new URL(".pi/agent/extensions/node_modules/@earendil-works/pi-ai/dist/api/openai-responses-shared.js", root));
const { applyUserProfile } = await import(new URL("scripts/pi/setup/user-profile.mjs", root));
// Runner uses Pi's runtime compat export for `stream`; isolate its pure guard.
const runnerSource = fs.readFileSync(capability("runner"), "utf8");
const runnerAst = ts.createSourceFile("runner.ts", runnerSource, ts.ScriptTarget.Latest, true);
const guard = runnerAst.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === "assertCapabilityTools");
const guardJs = ts.transpileModule(guard.getText(runnerAst).replace("export ", ""), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const assertCapabilityTools = new Function(`${guardJs}; return assertCapabilityTools;`)();
const { buildScoutTools } = await import(capability("scoutTools"));
const { CapabilityBackground } = await import(capability("background"));
const timestamp = "2026-11-12T00:00:00.000Z";
const message = (id, value) => ({ type: "message", id, parentId: null, timestamp, message: value });
const call = (id, callId) => message(id, { role: "assistant", content: [{ type: "toolCall", id: callId, name: "read", arguments: { path: "x" } }], stopReason: "toolUse", provider: "opencode-go", model: "x", api: "openai-completions", timestamp: 0 });
const result = (id, callId) => message(id, { role: "toolResult", toolCallId: callId, toolName: "read", content: [{ type: "text", text: "result" }], isError: false, timestamp: 0 });
const user = id => message(id, { role: "user", content: "task", timestamp: 0 });
const link = entries => entries.map((entry, index) => ({ ...entry, parentId: entries[index - 1]?.id ?? null }));
const compaction = firstKeptEntryId => ({ type: "compaction", id: "compact", parentId: null, timestamp, firstKeptEntryId, summary: "Earlier work", tokensBefore: 1000 });
const model = { id: "gpt-6.1-sol", provider: "openai", api: "openai-responses", input: ["text", "image"], reasoning: true };
function assertPairs(entries) {
  const messages = sdk.buildSessionContext(entries).messages;
  const items = convertResponsesMessages(model, { messages }, new Set(["openai"]), {});
  const pending = new Set();
  for (const item of items) {
    if (item.type === "function_call") pending.add(item.call_id);
    if (item.type === "function_call_output") { assert.ok(pending.has(item.call_id), `orphan ${item.call_id}`); pending.delete(item.call_id); }
  }
  assert.equal(pending.size, 0);
}

test("projection repair drops outputs for compacted calls, closes missing calls, records repairs", () => {
  const input = link([call("old", "old-call"), user("kept"), compaction("kept"), result("orphan", "old-call"), call("current", "new-call")]);
  const before = structuredClone(input);
  const fixed = repairCoderTranscript(input, true);
  assert.deepEqual(input, before, "repair is pure");
  assert.equal(fixed.repairCount, 2);
  assertPairs(fixed.entries);
  assert.equal(repairCoderTranscript(fixed.entries).repairCount, 0, "idempotent");
  const rows = coderSession(input, "/tmp").trim().split("\n").map(JSON.parse);
  assert.equal(rows.at(-1).data.repairCount, 2);
});

test("firstKept retained calls and context edits match actual SDK projection", () => {
  const retained = link([user("before"), call("kept", "keep-call"), compaction("kept"), result("answer", "keep-call")]);
  assert.equal(repairCoderTranscript(retained, true).repairCount, 0);
  assertPairs(retained);
  const edited = link([call("hidden", "hidden-call"), result("answer", "hidden-call"),
    { type: "context_edit", id: "edit", timestamp, targetId: "hidden", replacement: null }]);
  const fixed = repairCoderTranscript(edited, true);
  assert.equal(fixed.repairCount, 1);
  assertPairs(fixed.entries);
});

test("missing call before user gets boundary output beside call", () => {
  const fixed = repairCoderTranscript(link([call("a", "a-call"), user("b")]), true);
  assert.equal(fixed.entries[1].message.toolCallId, "a-call");
  assertPairs(fixed.entries);
  const anchor = repairCoderTranscript(link([call("old", "x"), result("kept", "x"), compaction("kept"), user("new")]), true);
  assert.equal(anchor.entries.find(entry => entry.type === "compaction").firstKeptEntryId, "compact");
  assertPairs(anchor.entries);
});

test("real failed session fixture repairs without changing fixture", { skip: !fs.existsSync("/Users/abhishekbhakat/CODES/anime-gpui/.agents/capability-runs/coder-41fc441e-5857-4ae2-b5b8-3b910c8f8939/session.jsonl") }, () => {
  const fixture = "/Users/abhishekbhakat/CODES/anime-gpui/.agents/capability-runs/coder-41fc441e-5857-4ae2-b5b8-3b910c8f8939/session.jsonl";
  const before = fs.readFileSync(fixture, "utf8");
  const entries = before.trim().split("\n").map(JSON.parse).slice(1);
  const fixed = repairCoderTranscript(entries, true);
  assert.ok(fixed.repairCount > 0);
  assertPairs(fixed.entries);
  assert.equal(fs.readFileSync(fixture, "utf8"), before);
  console.log(`Failed fixture repair count: ${fixed.repairCount}`);
});

test("classify known failures and never retry after tools, steering, or retry budget", () => {
  const cases = { transcript: "No tool call found for function call output", auth: "OAuth session expired", "tool-missing": "Unknown tool read", transient: "HTTP 503 ECONNRESET", unknown: "Bad JSON" };
  for (const [expected, text] of Object.entries(cases)) assert.equal(classifyCoderError(text), expected);
  assert.equal(classifyCoderError("HTTP 401"), "auth");
  for (const errorClass of Object.keys(cases)) {
    assert.equal(canRetryCoder(errorClass, { toolsExecuted: 1, retryCount: 0, steered: false }), false);
    assert.equal(canRetryCoder(errorClass, { toolsExecuted: 0, retryCount: 1, steered: false }), false);
    assert.equal(canRetryCoder(errorClass, { toolsExecuted: 0, retryCount: 0, steered: true }), false);
  }
});

function fakeChild(directory, scenario) {
  fs.writeFileSync(path.join(directory, "scenario.json"), JSON.stringify(scenario));
  const executable = path.join(directory, "fake-pi.mjs");
  fs.writeFileSync(executable, `#!${process.execPath}
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
const args = process.argv.slice(2);
const session = args[args.indexOf("--session") + 1];
const directory = path.dirname(session);
const scenario = JSON.parse(fs.readFileSync(path.join(directory, "scenario.json")));
const counter = path.join(directory, "attempts.txt");
const attempt = fs.existsSync(counter) ? Number(fs.readFileSync(counter)) : 0;
fs.writeFileSync(counter, String(attempt + 1));
fs.writeFileSync(path.join(directory, "tool-preflight.json"), JSON.stringify(scenario.missing ? [] : ${JSON.stringify(CHILD_TOOLS.split(","))}));
const emit = record => console.log(JSON.stringify(record));
readline.createInterface({ input: process.stdin }).on("line", line => {
  const record = JSON.parse(line);
  if (record.type === "get_state") {
    emit({ type: "response", id: record.id, command: record.type, success: true, data: { model: { provider: "openai", id: "gpt-6.1-sol" } } }); return;
  }
  emit({ type: "response", id: record.id, command: "prompt", success: true, data: { disposition: "started" } });
  emit({ type: "agent_start" });
  if (scenario.tools) emit({ type: "tool_execution_start", toolName: "write", toolCallId: "new-call" });
  const error = scenario.errors[attempt];
  emit({ type: "message_end", message: { role: "assistant", content: error ? [] : [{ type: "text", text: "done" }], stopReason: error ? "error" : "stop", errorMessage: error } });
  emit({ type: "agent_settled" });
});
`, { mode: 0o700 });
  fs.writeFileSync(path.join(directory, "system.md"), "test");
  fs.writeFileSync(path.join(directory, "session.jsonl"), coderSession([user("task")], directory));
  return { cwd: directory, directory, executable, model: "openai/gpt-6.1-sol", thinking: "medium", task: "test", signal: new AbortController().signal };
}
for (const scenario of [
  { name: "transcript retry", errors: ["No tool call found for function call output", null], attempts: 2 },
  { name: "transient retry", errors: ["HTTP 503", null], attempts: 2 },
  { name: "retry budget", errors: ["HTTP 503", "HTTP 503"], attempts: 2, rejects: /\[transient\]/ },
  { name: "partial execution", errors: ["HTTP 503"], attempts: 1, tools: true, rejects: /tools=1/ },
  { name: "auth", errors: ["OAuth session expired"], attempts: 1, rejects: /userprofile.json capabilities.coder/ },
  { name: "unknown", errors: ["bad packet"], attempts: 1, rejects: /\[unknown\]/ },
  { name: "missing tool", errors: [], attempts: 1, missing: true, rejects: /\[tool-missing\]/ },
]) {
  test(`RPC ${scenario.name}`, async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "coder-recovery-"));
    try {
      const options = fakeChild(directory, scenario);
      if (scenario.rejects) await assert.rejects(coderRpc(options), scenario.rejects);
      else assert.equal(await coderRpc(options), "done");
      assert.equal(Number(fs.readFileSync(path.join(directory, "attempts.txt"))), scenario.attempts);
      const recovery = JSON.parse(fs.readFileSync(path.join(directory, "recovery.json")));
      assert.equal(recovery.retryCount, scenario.attempts - 1);
      assert.match(fs.readFileSync(path.join(directory, "progress.log"), "utf8"), /repairs=0/);
      assert.ok(fs.existsSync(path.join(directory, "transcript-repairs.jsonl")));
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });
}

test("native tool preflight rejects unresolved declarations", () => {
  assert.doesNotThrow(() => assertCapabilityTools(["read"], buildScoutTools(["read"]), "deepseek/deepseek-flash"));
  assert.throws(() => assertCapabilityTools(["read", "missing"], buildScoutTools(["read", "missing"]), "deepseek/deepseek-flash"), /\[tool-missing\].*missing tools missing/);
  assert.throws(() => assertCapabilityTools(["read"], [], "deepseek/deepseek-flash"), /missing tools read/);
});

test("background result and progress show recovery class and counts", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "coder-background-"));
  try {
    const messages = [];
    const background = new CapabilityBackground({ sendMessage: message => messages.push(message), events: { emit() {} } });
    const context = { cwd: directory, sessionManager: { getSessionId: () => "test" },
      isIdle: () => true, ui: { setWidget() {}, setStatus() {}, notify() {}, theme: { fg: (_color, text) => text } } };
    background.start("coder", context, async (_signal, runDirectory) => {
      fs.writeFileSync(path.join(runDirectory, "recovery.json"), JSON.stringify({ errorClass: "transcript", repairCount: 1, retryCount: 1, toolsExecuted: 0 }));
      return { content: [{ type: "text", text: "done" }], details: { status: "done" } };
    });
    const run = [...background.runs.values()][0];
    await run.completion;
    assert.equal(run.status, "done");
    assert.match(fs.readFileSync(path.join(run.directory, "result.txt"), "utf8"), /class=transcript, repairs=1, retries=1/);
    assert.match(fs.readFileSync(path.join(run.directory, "progress.log"), "utf8"), /class=transcript, repairs=1, retries=1/);
    assert.match(messages[0].content, /class=transcript, repairs=1, retries=1/);
    await background.cancelAll();
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("install reports model override and missing profile roles without touching defaults", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "coder-profile-"));
  try {
    const agent = path.join(directory, "agent");
    const capabilityDir = path.join(agent, "extensions", "capability-tools");
    fs.mkdirSync(capabilityDir, { recursive: true });
    fs.cpSync(new URL(".pi/agent/extensions/capability-tools/capabilities/", root), path.join(capabilityDir, "capabilities"), { recursive: true });
    for (const name of ["definitions.ts", "booleanGuy.ts"]) fs.copyFileSync(new URL(`.pi/agent/extensions/capability-tools/${name}`, root), path.join(capabilityDir, name));
    const profilePath = path.join(directory, "profile.json");
    fs.writeFileSync(profilePath, JSON.stringify({ version: 1, capabilities: { coder: { model: "openai/gpt-6.1-sol", reasoningEffort: "medium" } } }));
    const logs = [];
    const result = applyUserProfile(agent, { profilePath, root: directory, log: value => logs.push(value) });
    assert.ok(logs.some(value => value.includes("coder: claude-code-sdk/opus -> openai/gpt-6.1-sol")));
    assert.ok(result.warnings.some(value => value.includes("capabilities.scout: no profile entry")));
    assert.match(fs.readFileSync(path.join(capabilityDir, "capabilities", "coder.md"), "utf8"), /model: openai\/gpt-6.1-sol/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
