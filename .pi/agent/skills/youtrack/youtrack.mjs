#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const NAME = "youtrack";
const SERVER = "youtrack";
const HELP = "youtrack list\nyoutrack describe <tool>\nyoutrack call <tool> '<arguments-json>'\nyoutrack search <query>\n\nToken: YOUTRACK_MCP_TOKEN, then youtrack-auth.json.\nOutputs compact JSON. Legacy --list, --describe and --call forms also work.";

function shortcut(command, args) {
  if (command !== "search") throw new Error("Unknown command. Use --help.");
  if (!args.length || !args.join(" ").trim()) throw new Error("search needs a query");
  return { action: "call", tool: "search_issues", arguments: { query: args.join(" ") } };
}
function prepare() {}
function environment() {
  const token = process.env.YOUTRACK_MCP_TOKEN || readJson("./youtrack-auth.json", true).access_token;
  if (typeof token !== "string" || !token.trim() || token.startsWith("YOUR_")) {
    throw new Error("No YouTrack token found. Create youtrack-auth.json from youtrack-auth.sample.json or set YOUTRACK_MCP_TOKEN.");
  }
  return { ...process.env, YOUTRACK_MCP_TOKEN: token };
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
