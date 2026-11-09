import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const moduleUrl = path => new URL(`.pi/agent/extensions/node_modules/@earendil-works/pi-ai/dist/${path}`, root).href;
const { normalizeContext } = await import(moduleUrl("utils/transcript.js"));
const { stream } = await import(moduleUrl("api/openai-completions.js"));
const { DEEPSEEK_MODELS } = await import(moduleUrl("providers/deepseek.models.js"));
const model = Object.values(DEEPSEEK_MODELS).find(item => item.id === "deepseek-flash");
assert.ok(model);

// Exercise the actual dispatch expression without loading the full Pi extension.
const source = readFileSync(new URL(".pi/agent/extensions/capability-tools/runner.ts", root), "utf8");
const expression = source.match(/const eventStream = ([\s\S]*?);/)?.[1];
assert.ok(expression);
const dispatch = new Function("provider", "model", "requestContext", "requestOptions", "normalizeContext", "piAiStream", `return ${expression};`);
const context = {
  systemPrompt: "Make at least 3 native read calls.",
  tools: [{
    name: "read",
    description: "Read file",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  }],
  messages: [{ role: "user", content: "Inspect code", timestamp: 0 }],
};

test("direct DeepSeek request preserves tools and system instructions", async () => {
  let payload;
  const options = {
    apiKey: "offline-placeholder",
    toolChoice: "auto",
    onPayload(value) {
      payload = value;
      throw new Error("Offline test: stop before HTTP request");
    },
  };
  const result = await dispatch({ stream }, model, context, options, normalizeContext, () => {
    throw new Error("Unexpected fallback");
  }).result();
  assert.equal(result.stopReason, "error");
  assert.ok(payload, "request reached payload hook");
  assert.equal(payload.model, "deepseek-flash");
  assert.deepEqual(payload.tools.map(tool => tool.function.name), ["read"]);
  assert.equal(payload.tools[0].function.parameters.properties.path.type, "string");
  assert.equal(payload.messages[0].role, "system");
  assert.equal(payload.messages[0].content, context.systemPrompt);
  assert.equal(payload.messages[1].role, "user");
  assert.equal(payload.tool_choice, "auto");
});

test("fallback receives original context for wrapper normalization", () => {
  const options = {};
  const marker = {};
  const result = dispatch(undefined, model, context, options, normalizeContext, (actualModel, actualContext, actualOptions) => {
    assert.equal(actualModel, model);
    assert.equal(actualContext, context);
    assert.equal(actualOptions, options);
    return marker;
  });
  assert.equal(result, marker);
});
