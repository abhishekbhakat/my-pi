# chrome-cdp skill

A lightweight Chrome DevTools Protocol CLI for AI coding agents. Connects directly via WebSocket — no Puppeteer, no browser automation framework.

This lets your agents to use your current session for browsing - allowing them to inspect and interact with your tabs.

## Why not chrome-devtools-mcp?

[chrome-devtools-mcp](https://github.com/modelcontextprotocol/servers) uses Puppeteer under the hood, which opens a dedicated WebSocket connection per command. With many tabs open, Puppeteer frequently times out during target enumeration. `chrome-cdp` connects directly and works reliably with 100+ tabs.

### Chrome's "Allow debugging" allowlist

Chrome shows a one-time **Allow debugging** modal the first time a remote debugging client connects to a tab. Both tools require user approval — but they handle persistence differently:

- **chrome-devtools-mcp**: each command reconnects, so the modal can re-appear.
- **chrome-cdp**: on first access, a per-tab background daemon is spawned that holds the WebSocket session open. Subsequent commands reuse it — no repeated modals. Daemons auto-exit after 20 minutes of inactivity.

## Installation

1. **Enable remote debugging in Chrome**: navigate to `chrome://inspect/#remote-debugging` and toggle the switch.

2. **Copy the skill** into your pi skills directory (or wherever your agent loads skills from):
   ```
   cp -r . ~/.pi/agent/skills/chrome-cdp
   ```

3. **Node.js 22+** is required (the script uses the built-in `WebSocket` API, no npm install needed).

## Manual Usage (you are unlikely to need it)

```bash
scripts/cdp.mjs list                            # list open tabs with disambiguating targetId prefixes
scripts/cdp.mjs shot <target>                   # screenshot → /tmp/screenshot.png
scripts/cdp.mjs snap <target>                   # accessibility tree (compact, semantic)
scripts/cdp.mjs html <target> [".selector"]     # full HTML or scoped to CSS selector
scripts/cdp.mjs eval <target> "expression"      # evaluate JS in page context
scripts/cdp.mjs nav  <target> https://...       # navigate and wait for load
scripts/cdp.mjs net  <target>                   # network resource timing
scripts/cdp.mjs stop [target]                   # stop daemon(s)
```

`<target>` is a unique prefix of the targetId shown by `list`. The CLI rejects ambiguous prefixes.
