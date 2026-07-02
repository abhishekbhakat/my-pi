#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "mcp>=1.0.0",
# ]
# ///
"""MCP Skill Executor - stdio transport"""

import json
import sys
import asyncio
import argparse
from pathlib import Path
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


async def run(config, args):
    server_params = StdioServerParameters(
        command=config["command"],
        args=config.get("args", []),
        env=config.get("env"),
    )

    async with stdio_client(server_params) as (read_stream, write_stream):
        async with ClientSession(read_stream, write_stream) as session:
            await session.initialize()

            if args.list:
                response = await session.list_tools()
                tools = [{"name": t.name, "description": t.description} for t in response.tools]
                print(json.dumps(tools, indent=2))

            elif args.describe:
                response = await session.list_tools()
                for tool in response.tools:
                    if tool.name == args.describe:
                        print(json.dumps({"name": tool.name, "description": tool.description, "inputSchema": tool.inputSchema}, indent=2))
                        return
                print(f"Tool not found: {args.describe}", file=sys.stderr)
                sys.exit(1)

            elif args.call:
                call_data = json.loads(args.call)
                result = await session.call_tool(call_data["tool"], call_data.get("arguments", {}))
                for item in result.content:
                    if hasattr(item, "text"):
                        print(item.text)
                    else:
                        print(json.dumps(item.model_dump(), indent=2))
                # Surface MCP tool errors as a non-zero exit so callers/automation
                # can detect failed searches, stale-project errors, and indexing
                # failures instead of treating them as success.
                if getattr(result, "isError", False):
                    sys.exit(1)
            else:
                # Unreachable: main() validates a mode before spawning the
                # server. Kept as a defensive no-op that does not raise inside
                # the asyncio task group.
                pass


def main():
    parser = argparse.ArgumentParser(description="MCP Skill Executor (stdio)")
    parser.add_argument("--call", help="JSON tool call to execute")
    parser.add_argument("--describe", help="Get tool schema")
    parser.add_argument("--list", action="store_true", help="List all tools")
    args = parser.parse_args()

    # Validate a mode was selected BEFORE spawning the server, so the no-arg
    # case prints a clean hint and exits without launching a subprocess or
    # raising SystemExit inside the asyncio task group.
    if not (args.list or args.describe or args.call):
        parser.print_help(sys.stderr)
        sys.exit(2)

    config_path = Path(__file__).parent / "mcp-config.json"
    if not config_path.exists():
        print(f"Error: {config_path} not found", file=sys.stderr)
        sys.exit(1)

    with open(config_path) as f:
        config = json.load(f)

    asyncio.run(run(config, args))


if __name__ == "__main__":
    main()
