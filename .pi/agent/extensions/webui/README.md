# webui extension

Browser UI for the current pi session.

## Design

This extension does **not** vendor `export-html` UI files.
Instead, it resolves the installed pi package at runtime and serves:

- `dist/core/export-html/template.html`
- `dist/core/export-html/template.css`
- `dist/core/export-html/template.js`
- `dist/core/export-html/vendor/*`

That means core export-html improvements are picked up automatically after pi upgrades.

Our extension only adds a thin live-control layer:

- `/webui` command
- local HTTP server
- SSE event stream for live refresh
- prompt + abort controls in browser
- small JS/CSS overlay on top of core export-html

## Tree

```text
webui/
├── index.ts
├── README.md
├── commands/
│   └── webui.ts
├── core/
│   ├── assets.ts
│   ├── page.ts
│   ├── session-data.ts
│   └── theme.ts
├── events/
│   └── session.ts
├── runtime/
│   ├── broadcast.ts
│   ├── state.ts
│   └── types.ts
├── server/
│   ├── browser.ts
│   ├── http-server.ts
│   └── routes.ts
├── utils/
│   ├── http.ts
│   └── path.ts
└── web/
    └── shell.ts
```

## File responsibilities

| File | Responsibility |
|------|----------------|
| `index.ts` | Extension entrypoint; wires commands and events |
| `commands/webui.ts` | Registers `/webui` and opens browser |
| `core/assets.ts` | Loads core export-html assets from installed pi package |
| `core/page.ts` | Builds final HTML page using core template + web shell |
| `core/session-data.ts` | Converts live pi session state into export-html data shape |
| `core/theme.ts` | Recreates export theme variable injection for browser page |
| `events/session.ts` | Tracks agent/session lifecycle and broadcasts live updates |
| `runtime/state.ts` | Creates in-memory runtime container |
| `runtime/types.ts` | Shared runtime types |
| `runtime/broadcast.ts` | SSE broadcasting helpers |
| `server/browser.ts` | Opens default browser on macOS/Linux/Windows |
| `server/http-server.ts` | Starts/stops local HTTP server |
| `server/routes.ts` | HTTP routes for page, session JSON, SSE, prompt, abort |
| `utils/http.ts` | JSON/body/SSE helpers |
| `utils/path.ts` | Resolves installed pi package and export-html paths |
| `web/shell.ts` | Thin browser enhancement layer on top of core export-html |

## Current behavior

- `/webui` starts a local server on a random localhost port
- browser opens automatically
- browser page reuses core export-html look and feel
- prompt form sends user prompts back into pi
- abort button calls `ctx.abort()`
- live updates are driven by SSE and page reloads

## Notes

Current live refresh is intentionally simple: on major session events, the page reloads to pick up fresh server-rendered session data while still using core export-html rendering logic.
That keeps us close to upstream behavior and minimizes breakage when pi core changes.
