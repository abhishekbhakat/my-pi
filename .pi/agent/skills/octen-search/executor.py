#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "httpx",
# ]
# ///
"""Octen Web Search skill executor (direct REST, not monid)."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

import httpx

BASE_URL = "https://api.octen.ai"
SKILL_DIR = Path(__file__).resolve().parent

TOOLS: dict[str, dict[str, Any]] = {
    "search": {
        "description": (
            "Focused real-time web search. Ranked results with highlights "
            "and optional full content, domain/time/language filters."
        ),
        "path": "/search",
        "inputSchema": {
            "type": "object",
            "required": ["query"],
            "properties": {
                "query": {"type": "string", "maxLength": 500},
                "topic": {"type": "string", "enum": ["general", "news"]},
                "count": {"type": "integer", "minimum": 1, "maximum": 100},
                "include_domains": {"type": "array", "items": {"type": "string"}},
                "exclude_domains": {"type": "array", "items": {"type": "string"}},
                "include_text": {"type": "array", "items": {"type": "string"}},
                "exclude_text": {"type": "array", "items": {"type": "string"}},
                "language": {"type": "array", "items": {"type": "string"}},
                "time_basis": {
                    "type": "string",
                    "enum": ["auto", "published", "crawled"],
                },
                "time_range": {
                    "type": "string",
                    "enum": ["day", "week", "month", "year", "d", "w", "m", "y"],
                },
                "start_time": {"type": "string"},
                "end_time": {"type": "string"},
                "country": {"type": "string"},
                "highlight": {"type": "object"},
                "format": {"type": "string", "enum": ["text", "markdown"]},
                "safesearch": {"type": "string", "enum": ["off", "strict"]},
                "full_content": {"type": "object"},
                "include_images": {"type": "boolean"},
            },
        },
    },
    "broad-search": {
        "description": (
            "Multi-angle research search. Expands one query into concurrent "
            "sub-queries. Pass the original question as-is."
        ),
        "path": "/broad-search",
        "inputSchema": {
            "type": "object",
            "required": ["query"],
            "properties": {
                "query": {"type": "string", "maxLength": 500},
                "max_queries": {"type": "integer", "minimum": 1, "maximum": 30},
                "search_options": {
                    "type": "object",
                    "description": "Same fields as search, applied per sub-query",
                },
            },
        },
    },
}


def die(message: str, code: int = 1) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(code)


def resolve_api_key() -> str:
    env_key = os.environ.get("OCTEN_API_KEY") or os.environ.get("OCTEN_KEY")
    if env_key and not env_key.startswith("YOUR_"):
        return env_key

    auth_path = SKILL_DIR / "octen-auth.json"
    if auth_path.exists():
        data = json.loads(auth_path.read_text())
        key = (
            data.get("api_key")
            or data.get("access_token")
            or data.get("token")
            or ""
        )
        if key and not key.startswith("YOUR_"):
            return key

    die(
        "Error: No Octen API key found.\n"
        "Create octen-auth.json from octen-auth.sample.json, or set OCTEN_API_KEY."
    )
    raise AssertionError("unreachable")


def load_json_arg(value: str) -> Any:
    text = value.strip()
    if text.startswith("@"):
        path = Path(text[1:])
        return json.loads(path.read_text())
    return json.loads(text)


def post(path: str, body: dict[str, Any]) -> dict[str, Any]:
    api_key = resolve_api_key()
    headers = {
        "Content-Type": "application/json",
        "X-Api-Key": api_key,
    }
    with httpx.Client(timeout=httpx.Timeout(30.0, read=120.0)) as client:
        response = client.post(f"{BASE_URL}{path}", headers=headers, json=body)
    try:
        payload = response.json()
    except json.JSONDecodeError:
        die(f"HTTP {response.status_code}: non-JSON response\n{response.text[:500]}")

    if response.status_code == 401:
        die(
            "HTTP 401: invalid or missing Octen API key.\n"
            "Check octen-auth.json or OCTEN_API_KEY. Get a key at "
            "https://octen.ai/platform/api-keys"
        )
    if response.status_code == 403:
        die(
            "HTTP 403: insufficient Octen balance.\n"
            "Top up at https://octen.ai/platform"
        )
    if response.status_code >= 400:
        msg = payload.get("msg") if isinstance(payload, dict) else response.text
        die(f"HTTP {response.status_code}: {msg}")

    return payload if isinstance(payload, dict) else {"data": payload}


def cmd_list() -> None:
    tools = [
        {"name": name, "description": meta["description"]}
        for name, meta in TOOLS.items()
    ]
    print(json.dumps(tools, indent=2))


def cmd_describe(name: str) -> None:
    meta = TOOLS.get(name)
    if not meta:
        die(f"Tool not found: {name}\nAvailable: {', '.join(TOOLS)}")
    print(
        json.dumps(
            {
                "name": name,
                "description": meta["description"],
                "path": meta["path"],
                "inputSchema": meta["inputSchema"],
            },
            indent=2,
        )
    )


def cmd_call(raw: str) -> None:
    call = load_json_arg(raw)
    if not isinstance(call, dict):
        die("--call must be a JSON object")
    tool = call.get("tool")
    arguments = call.get("arguments") or {}
    if not tool:
        die('--call requires {"tool":"...","arguments":{...}}')
    if not isinstance(arguments, dict):
        die("arguments must be a JSON object")
    meta = TOOLS.get(tool)
    if not meta:
        die(f"Tool not found: {tool}\nAvailable: {', '.join(TOOLS)}")
    if "query" not in arguments or not str(arguments.get("query", "")).strip():
        die(f"{tool} requires arguments.query")
    result = post(meta["path"], arguments)
    print(json.dumps(result, indent=2, ensure_ascii=False))


def main() -> None:
    parser = argparse.ArgumentParser(description="Octen Web Search executor")
    parser.add_argument("--list", action="store_true", help="List tools")
    parser.add_argument("--describe", metavar="TOOL", help="Show tool schema")
    parser.add_argument(
        "--call",
        metavar="JSON",
        help='Tool call JSON, or @file.json. Example: \'{"tool":"search","arguments":{"query":"..."}}\'',
    )
    parser.add_argument(
        "--check-auth",
        action="store_true",
        help="Resolve API key and print ok/missing (no network)",
    )
    args = parser.parse_args()

    if args.check_auth:
        key = resolve_api_key()
        print(f"ok ({key[:8]}…{key[-4:]})" if len(key) > 12 else "ok")
        return
    if args.list:
        cmd_list()
        return
    if args.describe:
        cmd_describe(args.describe)
        return
    if args.call:
        cmd_call(args.call)
        return

    parser.print_help()
    raise SystemExit(2)


if __name__ == "__main__":
    main()
