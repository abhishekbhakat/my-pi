#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const converter = path.resolve(here, "..", "mcp-to-skill", "cli.mjs");
const defaultConfig = path.join(here, "mcp-config.json");
const products = {
  jira: { get: "getJiraIssue", search: "searchJiraIssuesUsingJql", other: /confluence/i },
  confluence: { get: "getConfluenceContent", search: "searchConfluence", other: /jira/i },
};
const readTools = new Set([
  "getAccessibleAtlassianResources", "atlassianUserInfo", "discover", "executeRead",
  "getJiraIssue", "searchJiraIssuesUsingJql", "getConfluenceContent", "searchConfluence",
  "search", "fetch",
]);

function usage(product) {
  return `${product}: Atlassian MCP CLI\n\n` +
    `Usage:\n` +
    `  ${product} sites                         List accessible Atlassian sites\n` +
    `  ${product} tools [--all]                 List live tools\n` +
    `  ${product} describe <tool>               Show the tool's input schema\n` +
    `  ${product} get --args '<json>'           Read an issue or content item\n` +
    `  ${product} search --args '<json>'        Search issues or content\n` +
    `  ${product} discover --args '<json>'      Discover deferred tools\n` +
    `  ${product} call <tool> [--args '<json>'] [--write | --destructive]\n\n` +
    `Use --args-file <path> instead of --args for sensitive or large JSON.\n` +
    `Pass --config <path> to use another MCP configuration.\n` +
    `Inspect the live schema before calling. Use sites to find cloudId.\n`;
}

function parse(product, args) {
  if (!products[product]) throw new Error("Expected jira or confluence");
  if (!args.length || args.includes("--help") || args.includes("-h")) return { help: true };
  const action = args.shift();
  if (!["sites", "tools", "list", "describe", "get", "search", "discover", "call"].includes(action)) {
    throw new Error(`Unknown command: ${action}`);
  }
  const options = { action };
  if (["describe", "call"].includes(action)) {
    if (!args.length || args[0].startsWith("--")) throw new Error(`${action} needs a tool name`);
    options.tool = args.shift();
  }
  while (args.length) {
    const flag = args.shift();
    const key = { "--config": "config", "--args": "args", "--arguments": "args", "--args-file": "argsFile", "--arguments-file": "argsFile" }[flag];
    if (["--all", "--write", "--destructive"].includes(flag)) {
      const booleanKey = flag.slice(2);
      if (options[booleanKey]) throw new Error(`Duplicate option: ${flag}`);
      options[booleanKey] = true;
    } else {
      if (!key) throw new Error(`Unknown option: ${flag}`);
      if (!args.length || args[0].startsWith("--")) throw new Error(`Missing value for ${flag}`);
      if (options[key] !== undefined) throw new Error(`Duplicate option: ${flag}`);
      options[key] = args.shift();
    }
  }
  if (options.args !== undefined && options.argsFile) throw new Error("Use either --args or --args-file");
  if (options.all && !["tools", "list"].includes(action)) throw new Error("--all is only valid for tools");
  if ((options.write || options.destructive) && action !== "call") throw new Error("Write flags are only valid for call");
  if ((options.args !== undefined || options.argsFile) && !["call", "get", "search", "discover"].includes(action)) {
    throw new Error("Arguments are only valid for call, get, search, or discover");
  }
  return options;
}

function requireWritePermission(tool, options) {
  const destructive = tool === "executeDestructive" || /^(delete|destroy|purge|remove|revoke|archive)/i.test(tool);
  if (destructive && !options.destructive) throw new Error("Destructive tools require --destructive");
  if (!destructive && !readTools.has(tool) && !options.write && !options.destructive) {
    throw new Error("Write or unknown tools require --write; destructive tools require --destructive");
  }
}

function invoke(args) {
  if (!fs.existsSync(converter)) throw new Error("MCP CLI missing. Run make install in the my-pi repository.");
  const result = spawnSync(process.execPath, [converter, ...args], { encoding: "utf8" });
  if (result.error) throw new Error(`Cannot start MCP CLI: ${result.error.code || "unknown error"}`);
  return result;
}

function main() {
  const product = process.argv[2];
  const options = parse(product, process.argv.slice(3));
  if (options.help) { console.log(usage(product)); return; }
  const config = path.resolve(options.config || defaultConfig);
  const common = ["--config", config];
  let args;
  if (["tools", "list"].includes(options.action)) {
    args = ["list", ...common];
  } else if (options.action === "describe") {
    args = ["describe", ...common, "--tool", options.tool];
  } else {
    const tool = options.action === "sites" ? "getAccessibleAtlassianResources" :
      options.action === "discover" ? "discover" :
      options.action === "call" ? options.tool : products[product][options.action];
    if (options.action === "call") requireWritePermission(tool, options);
    args = ["call", ...common, "--tool", tool];
    if (options.args !== undefined) args.push("--arguments", options.args);
    if (options.argsFile) args.push("--arguments-file", options.argsFile);
  }
  const result = invoke(args);
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exitCode = result.status ?? 1;
    return;
  }
  if (["tools", "list"].includes(options.action) && !options.all) {
    let tools;
    try { tools = JSON.parse(result.stdout); }
    catch { throw new Error("MCP CLI returned invalid tool-list JSON"); }
    if (!Array.isArray(tools)) throw new Error("MCP CLI returned an invalid tool list");
    const visible = tools.filter((tool) => typeof tool.name === "string" && !products[product].other.test(tool.name));
    console.log(JSON.stringify(visible, null, 2));
    if (visible.length !== tools.length) console.error("Other product tools hidden. Use --all to see every tool.");
  } else if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) process.stderr.write(result.stderr);
}

try { main(); }
catch (error) {
  console.error(`${process.argv[2] || "atlassian"}: ${error.message || "Unknown error"}`);
  process.exitCode = 2;
}
