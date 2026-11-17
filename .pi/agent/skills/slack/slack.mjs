#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const NAME = "slack";
const SERVER = "slack";
const HELP = "slack list\nslack describe <tool>\nslack call <tool> '<arguments-json>'\nslack read <channel>\nslack search <query>\nslack send <channel> <text...>\n\nToken: SLACK_MCP_TOKEN, then slack-auth.json, then slack-token.json.\nSend signed text or set SLACK_SIGN_NAME to append italic attribution.\nOAuth: bun slack-auth.mjs. Outputs compact JSON.\nLegacy --list, --describe and --call forms also work.";

function shortcut(command, args) {
  if (command === "read") {
    exact(args, 1, "read needs one channel ID");
    return { action: "call", tool: "slack_read_channel", arguments: { channel_id: args[0] } };
  }
  if (command === "search") {
    if (!args.length || !args.join(" ").trim()) throw new Error("search needs a query");
    return { action: "call", tool: "slack_search_public", arguments: { query: args.join(" ") } };
  }
  if (command === "send") {
    if (args.length < 2 || !args[0].trim() || !args.slice(1).join(" ").trim()) {
      throw new Error("send needs a channel ID and message text");
    }
    return { action: "call", tool: "slack_send_message",
      arguments: { channel_id: args[0], text: args.slice(1).join(" ") } };
  }
  throw new Error("Unknown command. Use --help.");
}
function prepare(request) {
  if (request.action !== "call" ||
      !["slack_send_message", "slack_schedule_message"].includes(request.tool)) return;
  const text = request.arguments.text;
  if (typeof text !== "string" || !text.trim()) throw new Error("Message text is required");
  if (/(?:^|\n)_sent by [^\r\n<>_]+?'s bot_\s*$/.test(text)) return;
  const name = process.env.SLACK_SIGN_NAME?.trim();
  if (!name || /[\r\n<>_]/.test(name)) {
    throw new Error("Resolve the current user's name with slack_read_user_profile, then set SLACK_SIGN_NAME or include a final italic signature. No message sent.");
  }
  request.arguments.text = text.trimEnd() + "\n_sent by " + name + "'s bot_";
}
function environment() {
  let token = process.env.SLACK_MCP_TOKEN;
  for (const file of ["./slack-auth.json", "./slack-token.json"]) {
    if (token) break;
    const stored = readJson(file, true).access_token;
    if (typeof stored === "string" && stored && !stored.startsWith("YOUR_")) token = stored;
  }
  if (typeof token !== "string" || !token.trim() || token.startsWith("YOUR_")) {
    throw new Error("No Slack access token found. Create slack-auth.json from slack-auth.sample.json, set SLACK_MCP_TOKEN, or run bun slack-auth.mjs to authenticate.");
  }
  return { ...process.env, SLACK_MCP_TOKEN: token };
}

function readJson(name, optional = false) {
  try { return JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8")); }
  catch (error) {
    if (optional && error.code === "ENOENT") return {};
    throw new Error(`Cannot read ${name}: ${error.code || "invalid JSON"}`);
  }
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function jsonObject(text) {
  let value;
  try { value = JSON.parse(text); }
  catch { throw new Error("Arguments must be valid JSON"); }
  if (!object(value)) throw new Error("Arguments must be a JSON object");
  return value;
}

function exact(args, count, usage) {
  if (args.length !== count || args.some((value) => !value.trim())) throw new Error(usage);
}

function parse(args) {
  const command = args.shift();
  if (command === "list" || command === "--list") {
    exact(args, 0, "list takes no arguments");
    return { action: "list" };
  }
  if (command === "describe" || command === "--describe") {
    exact(args, 1, "describe needs one tool name");
    return { action: "describe", tool: args[0] };
  }
  if (command === "call") {
    if (args.length === 1) args.push("{}");
    exact(args, 2, "call needs a tool name and JSON object");
    return { action: "call", tool: args[0], arguments: jsonObject(args[1]) };
  }
  if (command === "--call") {
    exact(args, 1, "--call needs one JSON tool call");
    const call = jsonObject(args[0]);
    if (typeof call.tool !== "string" || !call.tool.trim()) throw new Error("Tool name is required");
    const values = call.arguments ?? {};
    if (!object(values)) throw new Error("Arguments must be a JSON object");
    return { action: "call", tool: call.tool, arguments: values };
  }
  return shortcut(command, args);
}

function unpack(response) {
  if (response.structuredContent !== undefined) return response.structuredContent;
  if (!Array.isArray(response.content) || !response.content.length ||
      response.content.some((item) => item.type !== "text")) return response;
  const values = response.content.map(({ text }) => {
    try { return JSON.parse(text); }
    catch { return text; }
  });
  return values.length === 1 ? values[0] : values;
}

function run(request, env) {
  const cli = fileURLToPath(new URL("../mcp-to-skill/cli.mjs", import.meta.url));
  const config = fileURLToPath(new URL("./mcp.json", import.meta.url));
  if (!existsSync(cli)) throw new Error("mcp-to-skill is missing. Run make install in my-pi.");
  const args = [cli, request.action, "--config", config, "--server", SERVER];
  if (request.tool) args.push("--tool", request.tool);
  if (request.action === "call") args.push("--arguments", JSON.stringify(request.arguments));
  const child = spawnSync(process.execPath, args, {
    env, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 300_000,
  });
  if (child.error) throw new Error(`MCP command failed: ${child.error.code || "cannot start"}`);
  if (child.stderr) process.stderr.write(child.stderr);
  if (!child.stdout?.trim()) {
    if (child.status !== 0) { process.exitCode = 1; return; }
    throw new Error("mcp-to-skill returned no output");
  }
  let response;
  try { response = JSON.parse(child.stdout); }
  catch { throw new Error("mcp-to-skill returned invalid JSON"); }
  const failed = child.status !== 0 || response?.isError === true;
  (failed ? process.stderr : process.stdout).write(JSON.stringify(unpack(response)) + "\n");
  if (failed) process.exitCode = 1;
}

function main() {
  const args = process.argv.slice(2);
  if (!args.length || args[0] === "--help" || args[0] === "-h") {
    console.log(HELP);
    return;
  }
  const request = parse(args);
  prepare(request);
  run(request, environment());
}

try { main(); }
catch (error) {
  console.error(`${NAME}: ${error.message}`);
  process.exitCode = 1;
}
