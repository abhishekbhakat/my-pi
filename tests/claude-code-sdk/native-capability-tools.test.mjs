import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const { default: ts } = await import(new URL(".pi/agent/extensions/node_modules/typescript/lib/typescript.js", root).href);
const streamSource = readFileSync(new URL(".pi/agent/extensions/claude-code-sdk/stream.ts", root), "utf8");
const detectorSource = readFileSync(new URL(".pi/agent/extensions/capability-tools/toolish.ts", root), "utf8");
const detectorJs = ts.transpileModule(detectorSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const exports = {};
new Function("exports", detectorJs)(exports);
const { isHallucinatedToolAnswer } = exports;

// Evaluate the actual routing expression so the old capability exclusion fails.
const routingExpression = streamSource.match(/const nativeToolTurn = (.+);/)?.[1];
assert.ok(routingExpression, "native tool routing expression exists");
const route = new Function("piSessionId", "hasTools", "capability", `return ${routingExpression}`);

test("capability and main turns with tools use native bridge", () => {
  assert.equal(route("session", true, "code_scout"), true);
  assert.equal(route("session", true, undefined), true);
  assert.equal(route("session", false, "code_scout"), false);
  assert.equal(route(undefined, true, "code_scout"), false);
});

test("capability completion and errors cannot update main session mirror", () => {
  assert.match(streamSource, /if \(!capability && !stale\(\)\) \{\s*const record = await ensureRecord/);
  const nativeLoop = streamSource.slice(streamSource.indexOf("const nativeToolTurn ="));
  const reseeds = nativeLoop.split("\n").filter(line => line.includes("reseedRecord(piSessionId,"));
  assert.equal(reseeds.length, 2);
  for (const line of reseeds) assert.ok(line.includes("!capability"));
});

test("DSML with prose preamble is rejected", () => {
  const text = "I'll read the truncated provider files in full, plus the scout tools to confirm the exact path.\n" +
    '<｜｜DSML｜｜ calls><｜｜DSML｜｜ invoke name="read">payload</｜｜DSML｜｜ invoke></｜｜DSML｜｜ calls>';
  assert.equal(isHallucinatedToolAnswer(text), true);
});

test("read XML is rejected while fenced documentation remains prose", () => {
  const markup = '<read>{"path":"src/main.ts"}</read>';
  assert.equal(isHallucinatedToolAnswer(markup), true);
  assert.equal(isHallucinatedToolAnswer(`Example protocol documentation:\n\`\`\`xml\n${markup}\n\`\`\``), false);
  assert.equal(isHallucinatedToolAnswer("## Relevant Files\n- src/main.ts:1 - entry point"), false);
});
