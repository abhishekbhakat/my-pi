#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const help = `Tabletist read-only database CLI
Usage (tblt):
  tblt connections
  tblt tables <connection> [--tables a,b]
  tblt query <connection> --sql <statement> [--params '[...]']

Keep Tabletist open and enable agent access. Outputs compact JSON.
Run /Applications/Tabletist.app/Contents/MacOS/tabletist --help for app options.
`;

function parseCall(args) {
  const command = args.shift();
  if (command === "connections") {
    if (args.length) throw new Error("connections takes no arguments");
    return { tool: "list_connections", arguments: {} };
  }
  if (!["tables", "query"].includes(command)) throw new Error("Unknown command. Use --help.");
  const connection = args.shift();
  if (!connection || connection.startsWith("--")) throw new Error("Connection name is required");
  const allowed = command === "tables" ? ["--tables"] : ["--sql", "--params"];
  const options = {};
  while (args.length) {
    const flag = args.shift();
    if (!allowed.includes(flag)) throw new Error(`Unknown option: ${flag}`);
    if (Object.hasOwn(options, flag)) throw new Error(`Duplicate option: ${flag}`);
    if (!args.length || args[0].startsWith("--")) throw new Error(`Missing value for ${flag}`);
    options[flag] = args.shift();
  }
  const values = { connection };
  if (command === "tables") {
    if (options["--tables"] !== undefined) {
      values.tables = options["--tables"].split(",").map((table) => table.trim());
      if (values.tables.length > 20 || values.tables.some((table) => !table)) {
        throw new Error("--tables needs 1 to 20 comma-separated table names");
      }
    }
    return { tool: "describe_schema", arguments: values };
  }
  if (!options["--sql"]?.trim()) throw new Error("--sql is required");
  values.sql = options["--sql"];
  if (options["--params"] !== undefined) {
    try { values.params = JSON.parse(options["--params"]); }
    catch { throw new Error("--params must be a JSON array"); }
    if (!Array.isArray(values.params) || values.params.some((value) =>
      value !== null && !["string", "number", "boolean"].includes(typeof value))) {
      throw new Error("--params must be an array of strings, numbers, booleans, or null");
    }
  }
  return { tool: "run_query", arguments: values };
}

function unpack(response) {
  if (response.structuredContent !== undefined) return response.structuredContent;
  const content = response.content;
  if (!Array.isArray(content) || !content.length ||
      content.some((item) => item.type !== "text")) return response;
  const values = content.map(({ text }) => {
    try { return JSON.parse(text); }
    catch { return text; }
  });
  return values.length === 1 ? values[0] : values;
}

function main() {
  const args = process.argv.slice(2);
  if (!args.length || args[0] === "--help" || args[0] === "-h") {
    console.log(help);
    return;
  }
  const call = parseCall(args);
  const cli = fileURLToPath(new URL("../mcp-to-skill/cli.mjs", import.meta.url));
  const config = fileURLToPath(new URL("./mcp.json", import.meta.url));
  if (!existsSync(cli)) throw new Error("mcp-to-skill is missing. Run make install in my-pi.");
  const child = spawnSync(process.execPath, [
    cli, "call", "--config", config, "--server", "tabletist",
    "--tool", call.tool, "--arguments", JSON.stringify(call.arguments),
  ], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (child.error) throw new Error(child.error.message);
  if (child.stderr) process.stderr.write(child.stderr);
  if (child.stdout?.trim()) {
    let response;
    try { response = JSON.parse(child.stdout); }
    catch {
      process.stderr.write("tabletist: invalid JSON from mcp-to-skill\n");
      process.exitCode = 1;
      return;
    }
    const failed = response.isError === true || child.status !== 0;
    const output = JSON.stringify(unpack(response)) + "\n";
    (failed ? process.stderr : process.stdout).write(output);
    if (failed) process.exitCode = 1;
  } else if (child.status === 0) {
    throw new Error("mcp-to-skill returned no output");
  }
  if (child.status !== 0) process.exitCode = child.status ?? 1;
}

try { main(); }
catch (error) {
  console.error(`tabletist: ${error.message}`);
  process.exitCode = 1;
}
