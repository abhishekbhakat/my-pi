#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "mcp>=1.0.0",
#     "httpx",
# ]
# ///
"""MCP Skill Executor - HTTP (Streamable HTTP) transport"""

import json
import sys
import asyncio
import argparse
import os
from pathlib import Path
import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client


def resolve_auth_headers():
    skill_dir = Path(__file__).parent

    env_token = os.environ.get("YOUTRACK_MCP_TOKEN")
    if env_token:
        return {"Authorization": f"Bearer {env_token}"}

    auth_path = skill_dir / "youtrack-auth.json"
    if auth_path.exists():
        auth_data = json.loads(auth_path.read_text())
        token = auth_data.get("access_token", "")
        if token and not token.startswith("YOUR_"):
            return {"Authorization": f"Bearer {token}"}

    print(
        "Error: No YouTrack token found.\n"
        "Create youtrack-auth.json from youtrack-auth.sample.json or set YOUTRACK_MCP_TOKEN.",
        file=sys.stderr,
    )
    sys.exit(1)


async def run(config, args):
    url = config["url"]
    headers = resolve_auth_headers()

    http_client = httpx.AsyncClient(headers=headers, timeout=httpx.Timeout(30, read=60))

    async with http_client:
        async with streamable_http_client(url=url, http_client=http_client) as (
            read_stream,
            write_stream,
            _,
        ):
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
                else:
                    parser.print_help()


def main():
    parser = argparse.ArgumentParser(description="MCP Skill Executor (HTTP)")
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
