---
name: lightpanda
description: >-
  Lightpanda headless browser CLI for JavaScript-rendered pages. Use when tf
  fetch or curl return an empty shell DOM, when quotes or lists are missing
  because client-side JS builds them, when scraping an SPA, or when a task
  says "headless browser". Browser binary ships in the wheel, ~39 MB RAM per
  scrape vs Selenium+Chrome ~1 GB.
keywords: [lightpanda, headless browser, JS-rendered, SPA, scrape, fetch, markdown dump, CDP, uv tool]
---

# Lightpanda

Headless browser made for machines. Bundles its own engine binary, no Chrome,
no CDP wiring for basic use. Division of labor: `tf` (TinyFish) is the default
web path; lightpanda is the fallback when a page needs JavaScript to build its
DOM.

## Install check

Verify and install if missing:

```bash
command -v lightpanda >/dev/null 2>&1 || uv tool install lightpanda
```

```bash
lightpanda version
```

Binary lands in `~/.local/bin` (ensure in `PATH`). Verified on CLI 0.4.0.
If flags or behavior mismatch, upgrade: `uv tool upgrade lightpanda`.

## fetch

Load URL in real browser, run its JS, dump result:

```bash
lightpanda fetch <url> --dump markdown
```

Common variants:

```bash
# First matching element only (markdown of that subtree)
lightpanda fetch <url> --dump markdown --dump-selector ".quote"

# Cap output size, avoids context blowout on big pages. Probe with 8-16 KB.
lightpanda fetch <url> --dump markdown --dump-max-bytes 8000

# Multiple URLs, one page each, JSON status output
lightpanda fetch <url1> <url2> --json --dump markdown

# HTTP error becomes failure instead of warning
lightpanda fetch <url> --dump markdown --fail-on-http-error

# Slow JS page: wait for selector or JS expression
lightpanda fetch <url> --dump markdown --wait-selector ".quote" --wait-ms 5000

# Cookies in/out as JSON files
lightpanda fetch <url> --cookie cookies.json --cookie-jar out.json --dump markdown
```

Dump formats: `html`, `markdown`, `png` (base64 with `--json`),
`semantic_tree`, `semantic_tree_text`.

## Verified behaviors (gotchas)

1. Bare `lightpanda fetch <url>` with no `--dump` prints nothing and exits 0.
   Not a failure. Always pass `--dump`.
2. `--dump-selector` with no match: stderr shows `err=SelectorNotFound`,
   exit 1. Selector typo, never network failure.
3. Multiple URLs without `--json`: exit 1, `multiple URLs require --json`.
4. 404 or other HTTP error: logs `page http error ... status=404` but exits 0
   unless `--fail-on-http-error`, which exits 22.
5. Markdown dump can contain empty `[text]()` links. Normal output, do not
   retry with other flags to "fix" it.
6. No documented default timeout. For sites that may hang, wrap the call in
   shell `timeout` and use `--wait-ms` for slow JS.

## Other commands

- `mcp`: starts an MCP server. Pi ships no built-in MCP client. Never wait
  for MCP tools to appear in pi, no matter how this is installed.
- `serve`: CDP-over-WebSocket server, for driving from Playwright/Puppeteer.
  Out of scope here unless user asks explicitly.
- `run <script.js>`: replay a saved PandaScript, no LLM call. Non-zero exit
  on failure. Only run scripts you trust: `.js` files can `evaluate(...)`
  arbitrary page JavaScript.
- `agent`: interactive browsing agent, needs LLM API key from env
  (`ANTHROPIC_API_KEY`, `HF_TOKEN`, or `--provider ollama`). Do not use when
  no key is configured.

## Python SDK

Structured extraction with `page.extract(schema=...)` exists via the
`lightpanda` PyPI package. Do not reach for it in terminal tasks; CLI fetch
covers them. Reference: https://lightpanda.io/docs/guides/use-python
