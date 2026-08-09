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
import os
from pathlib import Path
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


def resolve_mcp_url():
    skill_dir = Path(__file__).parent

    env_url = os.environ.get("ZOHO_MCP_URL")
    if env_url:
        return env_url

    auth_path = skill_dir / "zoho-auth.json"
    if auth_path.exists():
        auth_data = json.loads(auth_path.read_text())
        url = auth_data.get("mcp_url", "")
        if url and not url.startswith("YOUR_"):
            return url

    config_path = skill_dir / "mcp-config.json"
    if config_path.exists():
        args = json.loads(config_path.read_text()).get("args", [])
        for arg in args:
            if arg.startswith("http"):
                return arg

    print(
        "Error: No Zoho MCP URL found.\n"
        "Create zoho-auth.json from zoho-auth.sample.json or set ZOHO_MCP_URL.",
        file=sys.stderr,
    )
    sys.exit(1)


async def run(config, args):
    mcp_url = resolve_mcp_url()
    server_params = StdioServerParameters(
        command="npx",
        args=["mcp-remote", mcp_url, "--transport", "http-only"],
    )

    completed = False
    try:
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
                            schema = getattr(tool, "inputSchema", None) or getattr(tool, "input_schema", None)
                            print(json.dumps({"name": tool.name, "description": tool.description, "inputSchema": schema}, indent=2))
                            completed = True
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
                else:
                    parser.print_help()
                completed = True
    except Exception:
        if not completed:
            raise


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

    asyncio.run(run(config, args))


if __name__ == "__main__":
    main()
