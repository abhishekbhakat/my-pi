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


def tool_input_schema(tool):
    """SDK may expose inputSchema or input_schema; normalize to plain dict."""
    schema = getattr(tool, "inputSchema", None)
    if schema is None:
        schema = getattr(tool, "input_schema", None)
    if schema is None:
        return None
    if hasattr(schema, "model_dump"):
        return schema.model_dump()
    if isinstance(schema, dict):
        return schema
    try:
        return dict(schema)
    except Exception:
        return schema


async def run(config, args, parser) -> int:
    """Return process exit code (0 ok, 1 not found / usage)."""
    server_params = StdioServerParameters(
        command=config["command"],
        args=config.get("args", []),
        env=config.get("env"),
    )

    exit_code = 0
    completed = False
    try:
        async with stdio_client(server_params) as (read_stream, write_stream):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()

                if args.list:
                    response = await session.list_tools()
                    tools = [{"name": t.name, "description": t.description} for t in response.tools]
                    print(json.dumps(tools, indent=2))
                    completed = True

                elif args.describe:
                    response = await session.list_tools()
                    match = next((t for t in response.tools if t.name == args.describe), None)
                    if match is None:
                        print(f"Tool not found: {args.describe}", file=sys.stderr)
                        exit_code = 1
                    else:
                        print(
                            json.dumps(
                                {
                                    "name": match.name,
                                    "description": match.description,
                                    "inputSchema": tool_input_schema(match),
                                },
                                indent=2,
                            )
                        )
                    completed = True

                elif args.call:
                    call_data = json.loads(args.call)
                    result = await session.call_tool(call_data["tool"], call_data.get("arguments", {}))
                    for item in result.content:
                        if hasattr(item, "text"):
                            print(item.text)
                        else:
                            print(json.dumps(item.model_dump(), indent=2))
                    completed = True
                else:
                    parser.print_help()
                    completed = True
    except BaseException:
        if not completed:
            raise

    return exit_code


def main():
    parser = argparse.ArgumentParser(description="MCP Skill Executor (stdio)")
    parser.add_argument("--call", help="JSON tool call to execute")
    parser.add_argument("--describe", help="Get tool schema")
    parser.add_argument("--list", action="store_true", help="List all tools")
    args = parser.parse_args()

    config_path = Path(__file__).parent / "mcp-config.json"
    if not config_path.exists():
        print(f"Error: {config_path} not found", file=sys.stderr)
        sys.exit(1)

    with open(config_path) as f:
        config = json.load(f)

    sys.exit(asyncio.run(run(config, args, parser)))


if __name__ == "__main__":
    main()
