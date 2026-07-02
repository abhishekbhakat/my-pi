#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "httpx",
# ]
# ///
"""Slack OAuth helper for the Slack MCP server.

Performs a public-client PKCE flow (no client_secret required) and caches the
resulting user access token in slack-token.json next to this script.
"""

import base64
import hashlib
import json
import secrets
import sys
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from threading import Thread

import asyncio
import httpx

AUTH_ENDPOINT = "https://slack.com/oauth/v2/authorize"
TOKEN_ENDPOINT = "https://slack.com/api/oauth.v2.user.access"

DEFAULT_SCOPES = [
    "canvases:read",
    "canvases:write",
    "channels:history",
    "channels:read",
    "channels:write",
    "chat:write",
    "emoji:read",
    "files:read",
    "groups:history",
    "groups:read",
    "groups:write",
    "im:history",
    "im:read",
    "im:write",
    "mpim:history",
    "mpim:read",
    "mpim:write",
    "reactions:read",
    "reactions:write",
    "search:read",
    "search:read.private",
    "search:read.public",
    "users:read",
    "users:read.email",
]


def load_config():
    config_path = Path(__file__).parent / "mcp-config.json"
    if not config_path.exists():
        print(f"Error: {config_path} not found", file=sys.stderr)
        sys.exit(1)
    return json.loads(config_path.read_text())


def get_client_id(config):
    # Prefer slack-auth.json so secrets live in one place.
    auth_path = Path(__file__).parent / "slack-auth.json"
    if auth_path.exists():
        auth_data = json.loads(auth_path.read_text())
        client_id = auth_data.get("client_id", "")
        if client_id and not client_id.startswith("YOUR_"):
            return client_id

    # Fallback to mcp-config.json for backwards compatibility.
    for block_name in ("oauth", "auth"):
        block = config.get(block_name, {})
        if not isinstance(block, dict):
            continue
        for key in ("client_id", "CLIENT_ID", "clientId"):
            if key in block:
                return block[key]
    print("Error: client_id not found in slack-auth.json or mcp-config.json", file=sys.stderr)
    sys.exit(1)


def get_redirect_uri(config):
    oauth = config.get("oauth", {})
    redirect_uri = oauth.get("redirect_uri")
    if redirect_uri:
        return redirect_uri
    port = oauth.get("callback_port", 3118)
    return f"http://localhost:{port}/oauth/callback"


def get_scopes(config):
    oauth = config.get("oauth", {})
    scopes = oauth.get("scopes")
    if isinstance(scopes, list):
        return ",".join(scopes)
    if isinstance(scopes, str):
        return scopes
    return ",".join(DEFAULT_SCOPES)


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def pkce_pair():
    verifier = b64url(secrets.token_bytes(64))
    challenge = b64url(hashlib.sha256(verifier.encode("ascii")).digest())
    return verifier, challenge


class CallbackHandler(BaseHTTPRequestHandler):
    code = None
    state = None
    error = None
    received = False

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/oauth/callback":
            self.send_response(404)
            self.end_headers()
            return

        qs = urllib.parse.parse_qs(parsed.query)
        if "error" in qs:
            CallbackHandler.error = qs["error"][0]
        if "code" in qs:
            CallbackHandler.code = qs["code"][0]
        if "state" in qs:
            CallbackHandler.state = qs["state"][0]
        CallbackHandler.received = True

        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        if CallbackHandler.error:
            self.wfile.write(b"<h1>Authorization failed</h1><p>You can close this tab.</p>")
        else:
            self.wfile.write(
                b"<h1>Authorization successful</h1>"
                b"<p>You can close this tab and return to the terminal.</p>"
            )

    def log_message(self, fmt, *args):
        pass


def start_server(port):
    server = HTTPServer(("127.0.0.1", port), CallbackHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


async def wait_for_callback(timeout=300):
    loop = asyncio.get_running_loop()
    end = loop.time() + timeout
    while not CallbackHandler.received and loop.time() < end:
        await asyncio.sleep(0.2)
    return CallbackHandler.received


async def exchange_code(client_id, redirect_uri, code, verifier):
    async with httpx.AsyncClient() as client:
        r = await client.post(
            TOKEN_ENDPOINT,
            data={
                "client_id": client_id,
                "code": code,
                "redirect_uri": redirect_uri,
                "code_verifier": verifier,
                "grant_type": "authorization_code",
            },
        )
    r.raise_for_status()
    return r.json()


def save_token(data, client_id):
    auth_path = Path(__file__).parent / "slack-auth.json"
    auth_data = {"client_id": client_id}
    if auth_path.exists():
        existing = json.loads(auth_path.read_text())
        auth_data.update(existing)
        auth_data["client_id"] = client_id
    auth_data["access_token"] = data.get("access_token")
    if "refresh_token" in data:
        auth_data["refresh_token"] = data["refresh_token"]
    auth_path.write_text(json.dumps(auth_data, indent=2))
    print(f"Token saved to {auth_path}")


async def main():
    config = load_config()
    client_id = get_client_id(config)
    redirect_uri = get_redirect_uri(config)
    scopes = get_scopes(config)
    verifier, challenge = pkce_pair()
    state = secrets.token_urlsafe(32)

    port = urllib.parse.urlparse(redirect_uri).port or 3118

    params = {
        "client_id": client_id,
        "user_scope": scopes,
        "redirect_uri": redirect_uri,
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    auth_url = f"{AUTH_ENDPOINT}?{urllib.parse.urlencode(params)}"

    server = start_server(port)
    try:
        webbrowser.open(auth_url)
    except Exception:
        pass
    print(f"If your browser didn't open, visit:\n{auth_url}\n")

    received = await wait_for_callback(timeout=300)
    server.shutdown()

    if not received:
        print("Error: timed out waiting for Slack authorization callback", file=sys.stderr)
        sys.exit(1)

    if CallbackHandler.error:
        print(f"Error: Slack authorization failed ({CallbackHandler.error})", file=sys.stderr)
        sys.exit(1)

    if CallbackHandler.state != state:
        print("Error: OAuth state mismatch", file=sys.stderr)
        sys.exit(1)

    token_data = await exchange_code(client_id, redirect_uri, CallbackHandler.code, verifier)
    if not token_data.get("ok"):
        print(f"Error exchanging code: {token_data.get('error')}", file=sys.stderr)
        sys.exit(1)

    save_token(token_data, client_id)
    print("Slack authentication complete. Run ./executor.py --list to verify.")


if __name__ == "__main__":
    asyncio.run(main())
