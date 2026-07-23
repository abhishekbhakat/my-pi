#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "httpx",
# ]
# ///
"""Notion REST API skill executor (API version 2026-03-11)."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

BASE_URL = "https://api.notion.com"
DEFAULT_VERSION = "2026-03-11"
SKILL_DIR = Path(__file__).resolve().parent

# UUID with or without dashes, optionally after a Notion URL slug.
UUID_RE = re.compile(
    r"(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
    r"|[0-9a-f]{32})",
    re.IGNORECASE,
)


def die(message: str, code: int = 1) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(code)


def resolve_auth() -> tuple[str, str]:
    env_token = (
        os.environ.get("NOTION_API_KEY")
        or os.environ.get("NOTION_TOKEN")
        or os.environ.get("NOTION_PAT")
    )
    env_version = os.environ.get("NOTION_VERSION", DEFAULT_VERSION)

    auth_path = SKILL_DIR / "notion-auth.json"
    if auth_path.exists():
        data = json.loads(auth_path.read_text())
        token = data.get("access_token") or data.get("token") or ""
        version = data.get("notion_version") or env_version
        if token and not token.startswith("YOUR_") and "YOUR_" not in token:
            return token, version

    if env_token:
        return env_token, env_version

    die(
        "Error: No Notion token found.\n"
        "Create notion-auth.json from notion-auth.sample.json, or set\n"
        "NOTION_API_KEY / NOTION_TOKEN / NOTION_PAT."
    )
    raise AssertionError("unreachable")


def normalize_id(value: str) -> str:
    """Extract a Notion ID from a bare UUID or a Notion URL."""
    raw = value.strip()
    if raw.startswith(("http://", "https://")):
        path = urlparse(raw).path.rstrip("/")
        segment = path.split("/")[-1]
        # URLs look like /Title-with-dashes-<32hexid>
        compact = re.sub(r"[^0-9a-fA-F]", "", segment)
        if len(compact) >= 32:
            hex_id = compact[-32:].lower()
        else:
            match = UUID_RE.search(raw)
            if not match:
                die(f"Could not extract Notion ID from URL: {value}")
            hex_id = match.group(0).replace("-", "").lower()
    else:
        match = UUID_RE.fullmatch(raw) or UUID_RE.search(raw)
        if not match:
            die(f"Invalid Notion ID: {value}")
        hex_id = match.group(0).replace("-", "").lower()

    if len(hex_id) != 32:
        die(f"Invalid Notion ID length after normalize: {value}")
    return (
        f"{hex_id[0:8]}-{hex_id[8:12]}-{hex_id[12:16]}-"
        f"{hex_id[16:20]}-{hex_id[20:32]}"
    )


def load_json_arg(value: str | None) -> Any:
    if value is None:
        return None
    text = value.strip()
    if text.startswith("@"):
        return json.loads(Path(text[1:]).read_text())
    return json.loads(text)


class NotionClient:
    def __init__(self, token: str, version: str) -> None:
        self.version = version
        self.client = httpx.Client(
            base_url=BASE_URL,
            headers={
                "Authorization": f"Bearer {token}",
                "Notion-Version": version,
                "Content-Type": "application/json",
            },
            timeout=httpx.Timeout(30.0, read=120.0),
        )

    def close(self) -> None:
        self.client.close()

    def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        body: Any = None,
    ) -> Any:
        if not path.startswith("/"):
            path = "/" + path
        response = self.client.request(method.upper(), path, params=params, json=body)
        try:
            data = response.json()
        except Exception:
            data = {"status_code": response.status_code, "text": response.text}

        if response.status_code >= 400:
            print(json.dumps(data, indent=2))
            raise SystemExit(1)
        return data


TOOLS: dict[str, str] = {
    "whoami": "GET /v1/users/me — current bot/user for this token",
    "search": "POST /v1/search — search pages and data sources by title",
    "get_page": "GET /v1/pages/{id} — page properties/metadata",
    "get_page_markdown": "GET /v1/pages/{id}/markdown — page body as enhanced markdown",
    "create_page": "POST /v1/pages — create page (markdown and/or properties)",
    "update_page": "PATCH /v1/pages/{id} — update properties/icon/cover/archived",
    "update_page_markdown": "PATCH /v1/pages/{id}/markdown — edit body via markdown commands",
    "move_page": "POST /v1/pages/{id}/move — move page to a new parent",
    "get_database": "GET /v1/databases/{id} — database metadata and data sources",
    "get_data_source": "GET /v1/data_sources/{id} — schema/properties for a data source",
    "query_data_source": "POST /v1/data_sources/{id}/query — filter/sort rows",
    "list_children": "GET /v1/blocks/{id}/children — list child blocks",
    "append_children": "PATCH /v1/blocks/{id}/children — append block children",
    "get_block": "GET /v1/blocks/{id}",
    "update_block": "PATCH /v1/blocks/{id}",
    "delete_block": "DELETE /v1/blocks/{id}",
    "list_comments": "GET /v1/comments?block_id= — comments on a page/block",
    "create_comment": "POST /v1/comments",
    "list_users": "GET /v1/users — workspace users (not available for PATs)",
    "get_user": "GET /v1/users/{id}",
    "get_async_task": "GET /v1/async_tasks/{id}",
    "raw": "Arbitrary Notion API call: method + path + optional JSON body",
}


def print_tools() -> None:
    print(json.dumps([{"name": k, "description": v} for k, v in TOOLS.items()], indent=2))


def print_describe(name: str) -> None:
    if name not in TOOLS:
        die(f"Unknown tool: {name}")
    schemas: dict[str, Any] = {
        "whoami": {"type": "object", "properties": {}},
        "search": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "filter_object": {
                    "type": "string",
                    "enum": ["page", "data_source"],
                    "description": "Limit results to pages or data sources",
                },
                "in_trash": {"type": "boolean"},
                "page_size": {"type": "integer"},
                "start_cursor": {"type": "string"},
                "sort": {"type": "object"},
            },
        },
        "get_page": {
            "type": "object",
            "required": ["id"],
            "properties": {"id": {"type": "string", "description": "Page ID or URL"}},
        },
        "get_page_markdown": {
            "type": "object",
            "required": ["id"],
            "properties": {"id": {"type": "string"}},
        },
        "create_page": {
            "type": "object",
            "properties": {
                "parent": {
                    "type": "object",
                    "description": "page_id / data_source_id / database_id / workspace parent",
                },
                "parent_page_id": {"type": "string"},
                "parent_data_source_id": {"type": "string"},
                "parent_database_id": {"type": "string"},
                "workspace": {"type": "boolean", "description": "Create private workspace page (PAT/public)"},
                "title": {"type": "string"},
                "markdown": {"type": "string"},
                "properties": {"type": "object"},
                "icon": {"type": "object"},
                "cover": {"type": "object"},
                "children": {"type": "array"},
                "template": {"type": "object"},
                "allow_async": {"type": "boolean"},
            },
        },
        "update_page": {
            "type": "object",
            "required": ["id"],
            "properties": {
                "id": {"type": "string"},
                "properties": {"type": "object"},
                "icon": {"type": ["object", "null"]},
                "cover": {"type": ["object", "null"]},
                "archived": {"type": "boolean"},
                "in_trash": {"type": "boolean"},
            },
        },
        "update_page_markdown": {
            "type": "object",
            "required": ["id", "command"],
            "properties": {
                "id": {"type": "string"},
                "command": {
                    "type": "string",
                    "enum": [
                        "update_content",
                        "replace_content",
                        "insert_content",
                        "replace_content_range",
                    ],
                },
                "new_str": {"type": "string"},
                "content_updates": {
                    "type": "array",
                    "description": "For update_content: [{old_str, new_str, replace_all_matches?}]",
                },
                "operations": {
                    "type": "array",
                    "description": "Alias for content_updates",
                },
                "content": {"type": "string", "description": "For insert_content / replace_content_range"},
                "position": {"type": "object"},
                "after": {"type": "string"},
                "content_range": {"type": "string"},
                "allow_deleting_content": {"type": "boolean"},
                "allow_async": {"type": "boolean"},
            },
        },
        "move_page": {
            "type": "object",
            "required": ["id", "parent"],
            "properties": {
                "id": {"type": "string"},
                "parent": {"type": "object"},
                "parent_page_id": {"type": "string"},
                "parent_database_id": {"type": "string"},
            },
        },
        "get_database": {
            "type": "object",
            "required": ["id"],
            "properties": {"id": {"type": "string"}},
        },
        "get_data_source": {
            "type": "object",
            "required": ["id"],
            "properties": {"id": {"type": "string"}},
        },
        "query_data_source": {
            "type": "object",
            "required": ["id"],
            "properties": {
                "id": {"type": "string"},
                "filter": {"type": "object"},
                "sorts": {"type": "array"},
                "start_cursor": {"type": "string"},
                "page_size": {"type": "integer"},
                "filter_properties": {"type": "array", "items": {"type": "string"}},
                "is_archived": {"type": "boolean"},
            },
        },
        "list_children": {
            "type": "object",
            "required": ["id"],
            "properties": {
                "id": {"type": "string"},
                "start_cursor": {"type": "string"},
                "page_size": {"type": "integer"},
            },
        },
        "append_children": {
            "type": "object",
            "required": ["id", "children"],
            "properties": {
                "id": {"type": "string"},
                "children": {"type": "array"},
                "after": {"type": "string"},
            },
        },
        "get_block": {
            "type": "object",
            "required": ["id"],
            "properties": {"id": {"type": "string"}},
        },
        "update_block": {
            "type": "object",
            "required": ["id"],
            "properties": {"id": {"type": "string"}, "body": {"type": "object"}},
        },
        "delete_block": {
            "type": "object",
            "required": ["id"],
            "properties": {"id": {"type": "string"}},
        },
        "list_comments": {
            "type": "object",
            "required": ["block_id"],
            "properties": {
                "block_id": {"type": "string"},
                "start_cursor": {"type": "string"},
                "page_size": {"type": "integer"},
            },
        },
        "create_comment": {
            "type": "object",
            "properties": {
                "parent": {"type": "object"},
                "page_id": {"type": "string"},
                "discussion_id": {"type": "string"},
                "rich_text": {"type": "array"},
                "text": {"type": "string", "description": "Shortcut for plain rich_text"},
            },
        },
        "list_users": {
            "type": "object",
            "properties": {
                "start_cursor": {"type": "string"},
                "page_size": {"type": "integer"},
            },
        },
        "get_user": {
            "type": "object",
            "required": ["id"],
            "properties": {"id": {"type": "string"}},
        },
        "get_async_task": {
            "type": "object",
            "required": ["id"],
            "properties": {"id": {"type": "string"}},
        },
        "raw": {
            "type": "object",
            "required": ["method", "path"],
            "properties": {
                "method": {"type": "string"},
                "path": {"type": "string"},
                "params": {"type": "object"},
                "body": {},
            },
        },
    }
    print(
        json.dumps(
            {
                "name": name,
                "description": TOOLS[name],
                "inputSchema": schemas.get(name, {"type": "object"}),
            },
            indent=2,
        )
    )


def title_property(title: str) -> dict[str, Any]:
    return {
        "title": [
            {
                "type": "text",
                "text": {"content": title},
            }
        ]
    }


def plain_rich_text(text: str) -> list[dict[str, Any]]:
    return [{"type": "text", "text": {"content": text}}]


def build_parent(args: dict[str, Any]) -> dict[str, Any] | None:
    if "parent" in args and args["parent"] is not None:
        parent = args["parent"]
        # Normalize nested IDs when present.
        for key in ("page_id", "database_id", "data_source_id"):
            if key in parent and isinstance(parent[key], str):
                parent = {**parent, key: normalize_id(parent[key])}
        return parent
    if args.get("parent_page_id"):
        return {"type": "page_id", "page_id": normalize_id(args["parent_page_id"])}
    if args.get("parent_data_source_id"):
        return {
            "type": "data_source_id",
            "data_source_id": normalize_id(args["parent_data_source_id"]),
        }
    if args.get("parent_database_id"):
        return {
            "type": "database_id",
            "database_id": normalize_id(args["parent_database_id"]),
        }
    if args.get("workspace"):
        return {"type": "workspace", "workspace": True}
    return None


def run_tool(client: NotionClient, name: str, args: dict[str, Any]) -> Any:
    if name == "whoami":
        return client.request("GET", "/v1/users/me")

    if name == "search":
        body: dict[str, Any] = {}
        if args.get("query"):
            body["query"] = args["query"]
        if args.get("page_size") is not None:
            body["page_size"] = args["page_size"]
        if args.get("start_cursor"):
            body["start_cursor"] = args["start_cursor"]
        if args.get("sort"):
            body["sort"] = args["sort"]
        filt: dict[str, Any] = {}
        if args.get("filter_object"):
            filt["property"] = "object"
            filt["value"] = args["filter_object"]
        if args.get("in_trash"):
            filt["in_trash"] = True
        if filt:
            body["filter"] = filt
        return client.request("POST", "/v1/search", body=body or {})

    if name == "get_page":
        return client.request("GET", f"/v1/pages/{normalize_id(args['id'])}")

    if name == "get_page_markdown":
        return client.request("GET", f"/v1/pages/{normalize_id(args['id'])}/markdown")

    if name == "create_page":
        body: dict[str, Any] = {}
        parent = build_parent(args)
        if parent is not None:
            body["parent"] = parent
        properties = dict(args.get("properties") or {})
        if args.get("title") and "title" not in properties and "Name" not in properties:
            # Child pages use the "title" property key. Data-source rows usually
            # use a titled property named "Name" — pass properties explicitly then.
            properties["title"] = title_property(args["title"])["title"]
        if properties:
            body["properties"] = properties
        for key in ("markdown", "icon", "cover", "children", "template", "allow_async"):
            if key in args and args[key] is not None:
                body[key] = args[key]
        return client.request("POST", "/v1/pages", body=body)

    if name == "update_page":
        body = {}
        for key in ("properties", "icon", "cover", "archived", "in_trash"):
            if key in args:
                body[key] = args[key]
        return client.request("PATCH", f"/v1/pages/{normalize_id(args['id'])}", body=body)

    if name == "update_page_markdown":
        # Request body is a flat oneOf: {type, <command_object>, allow_async?}
        command = args["command"]
        body: dict[str, Any] = {"type": command}
        if args.get("allow_async") is not None:
            body["allow_async"] = args["allow_async"]

        if command == "replace_content":
            payload = {"new_str": args["new_str"]}
            if args.get("allow_deleting_content"):
                payload["allow_deleting_content"] = True
            body["replace_content"] = payload
        elif command == "update_content":
            ops = args.get("content_updates") or args.get("operations")
            if not ops:
                die(
                    "update_content requires content_updates="
                    "[{old_str,new_str,...}] (operations is accepted as alias)"
                )
            payload = {"content_updates": ops}
            if args.get("allow_deleting_content"):
                payload["allow_deleting_content"] = True
            body["update_content"] = payload
        elif command == "insert_content":
            payload = {"content": args.get("content") or args.get("new_str") or ""}
            if args.get("position") is not None:
                payload["position"] = args["position"]
            if args.get("after") is not None:
                payload["after"] = args["after"]
            body["insert_content"] = payload
        elif command == "replace_content_range":
            payload = {
                "content_range": args["content_range"],
                "content": args.get("content") or args.get("new_str") or "",
            }
            if args.get("allow_deleting_content"):
                payload["allow_deleting_content"] = True
            body["replace_content_range"] = payload
        else:
            die(f"Unknown markdown command: {command}")
        return client.request(
            "PATCH",
            f"/v1/pages/{normalize_id(args['id'])}/markdown",
            body=body,
        )

    if name == "move_page":
        parent = build_parent(args)
        if parent is None:
            die("move_page requires parent / parent_page_id / parent_database_id")
        return client.request(
            "POST",
            f"/v1/pages/{normalize_id(args['id'])}/move",
            body={"parent": parent},
        )

    if name == "get_database":
        return client.request("GET", f"/v1/databases/{normalize_id(args['id'])}")

    if name == "get_data_source":
        return client.request("GET", f"/v1/data_sources/{normalize_id(args['id'])}")

    if name == "query_data_source":
        body = {}
        for key in ("filter", "sorts", "start_cursor", "page_size", "is_archived"):
            if key in args and args[key] is not None:
                body[key] = args[key]
        params = None
        if args.get("filter_properties"):
            # httpx encodes list query params as repeated keys.
            params = [("filter_properties", p) for p in args["filter_properties"]]
        path = f"/v1/data_sources/{normalize_id(args['id'])}/query"
        if params:
            # Use raw request for multi-value query params.
            response = client.client.request("POST", path, params=params, json=body or {})
            try:
                data = response.json()
            except Exception:
                data = {"status_code": response.status_code, "text": response.text}
            if response.status_code >= 400:
                print(json.dumps(data, indent=2))
                raise SystemExit(1)
            return data
        return client.request("POST", path, body=body or {})

    if name == "list_children":
        params = {}
        if args.get("start_cursor"):
            params["start_cursor"] = args["start_cursor"]
        if args.get("page_size") is not None:
            params["page_size"] = args["page_size"]
        return client.request(
            "GET",
            f"/v1/blocks/{normalize_id(args['id'])}/children",
            params=params or None,
        )

    if name == "append_children":
        body = {"children": args["children"]}
        if args.get("after"):
            body["after"] = normalize_id(args["after"])
        return client.request(
            "PATCH",
            f"/v1/blocks/{normalize_id(args['id'])}/children",
            body=body,
        )

    if name == "get_block":
        return client.request("GET", f"/v1/blocks/{normalize_id(args['id'])}")

    if name == "update_block":
        body = args.get("body") or {k: v for k, v in args.items() if k != "id"}
        return client.request("PATCH", f"/v1/blocks/{normalize_id(args['id'])}", body=body)

    if name == "delete_block":
        return client.request("DELETE", f"/v1/blocks/{normalize_id(args['id'])}")

    if name == "list_comments":
        params: dict[str, Any] = {"block_id": normalize_id(args["block_id"])}
        if args.get("start_cursor"):
            params["start_cursor"] = args["start_cursor"]
        if args.get("page_size") is not None:
            params["page_size"] = args["page_size"]
        return client.request("GET", "/v1/comments", params=params)

    if name == "create_comment":
        body = {}
        if args.get("parent"):
            body["parent"] = args["parent"]
        elif args.get("page_id"):
            body["parent"] = {
                "page_id": normalize_id(args["page_id"]),
            }
        elif args.get("discussion_id"):
            body["discussion_id"] = args["discussion_id"]
        if args.get("rich_text"):
            body["rich_text"] = args["rich_text"]
        elif args.get("text"):
            body["rich_text"] = plain_rich_text(args["text"])
        return client.request("POST", "/v1/comments", body=body)

    if name == "list_users":
        params = {}
        if args.get("start_cursor"):
            params["start_cursor"] = args["start_cursor"]
        if args.get("page_size") is not None:
            params["page_size"] = args["page_size"]
        return client.request("GET", "/v1/users", params=params or None)

    if name == "get_user":
        return client.request("GET", f"/v1/users/{normalize_id(args['id'])}")

    if name == "get_async_task":
        return client.request("GET", f"/v1/async_tasks/{args['id']}")

    if name == "raw":
        return client.request(
            args["method"],
            args["path"],
            params=args.get("params"),
            body=args.get("body"),
        )

    die(f"Unknown tool: {name}")
    raise AssertionError("unreachable")


def main() -> None:
    parser = argparse.ArgumentParser(description="Notion REST API skill executor")
    parser.add_argument("--list", action="store_true", help="List tools")
    parser.add_argument("--describe", help="Describe a tool schema")
    parser.add_argument("--call", help='JSON: {"tool":"...","arguments":{...}}')
    parser.add_argument(
        "--normalize-id",
        help="Normalize a Notion URL/ID to dashed UUID and exit",
    )
    args = parser.parse_args()

    if args.normalize_id:
        print(normalize_id(args.normalize_id))
        return

    if args.list:
        print_tools()
        return

    if args.describe:
        print_describe(args.describe)
        return

    if not args.call:
        parser.print_help()
        raise SystemExit(1)

    call = load_json_arg(args.call)
    if not isinstance(call, dict) or "tool" not in call:
        die('Call JSON must be {"tool":"...","arguments":{...}}')

    tool = call["tool"]
    tool_args = call.get("arguments") or {}
    if not isinstance(tool_args, dict):
        die("arguments must be an object")

    token, version = resolve_auth()
    client = NotionClient(token, version)
    try:
        result = run_tool(client, tool, tool_args)
        print(json.dumps(result, indent=2))
    finally:
        client.close()


if __name__ == "__main__":
    main()
