---
name: tinyfish
description: >-
  TinyFish CLI for live web data in terminal: web search with ranked results,
  URL content extraction to clean markdown. Use whenever user need web results,
  current facts, news, prices, dates, anything past training cutoff, or ask to
  fetch/read a URL. pi have no built-in MCP, so CLI is only TinyFish path.
  Never wait for MCP tools to appear. Triggers: "use tinyfish", "search the
  web", "google", "look up online", "fetch this URL", "latest news", "what is
  the current".
keywords: [tinyfish, search, web search, fetch, url, browser agent, web agent, live data, mcp, connect, doctor]
---

# TinyFish

TinyFish = web-driving service. In pi, use CLI via `npx`. pi ships no built-in
MCP client (`docs/usage.md:308`). TinyFish never appears as tool set here, no
matter install or `/reload`.

Verified 2026-08-28, CLI 0.34.0. If `connect --help` later list `pi` as
harness, revisit: MCP path may exist.

## Credentials

Precedence:

1. `TINYFISH_API_KEY` env.
2. `tinyfish-auth.json` beside this file (gitignored, install-copies it).

```json
{ "api_key": "sk-tinyfish-..." }
```

Use `export`. Bash and zsh tested: `VAR=x && cmd` set VAR in shell, child still
blind, never exported.

```bash
# BROKEN. npx run with no key. doctor fail on "CLI credential".
TINYFISH_API_KEY=$(...) && npx -y @tiny-fish/cli@latest doctor

# WORK, preferred. Survives later calls in this shell.
export TINYFISH_API_KEY=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.env.HOME+"/.pi/agent/skills/tinyfish/tinyfish-auth.json","utf8")).api_key)')
npx -y @tiny-fish/cli@latest doctor --pretty

# WORK, per-command prefix. Key gone after one call.
TINYFISH_API_KEY=$(...) npx -y @tiny-fish/cli@latest doctor --pretty
```

Key missing: ask user once. No blind retry. Do not run `tinyfish auth set` or
`auth login`. They write second plaintext key outside repo control, gitignore
and `make install` stop governing it. `tinyfish-auth.json` stays single source.

## Commands

Search, ranked results with snippets:

```bash
npx -y @tiny-fish/cli@latest search query "<question or keywords>" --pretty
```

Flags: `--include-domains`, `--exclude-domains`, `--location`, `--language`,
`--page`.

Clean content from URL(s):

```bash
npx -y @tiny-fish/cli@latest fetch content get <url> [<url>...] --pretty
```

Drop `--pretty` to parse JSON. `results[].text` hold markdown body.

More subcommands exist: `agent`, `browser`, `profile`, `vault`, `wallet`. Read
`--help` before claiming capability absent.

## Verify a setup claim

`doctor` check CLI plus credential only. Green harness line mean nothing here:

```bash
npx -y @tiny-fish/cli@latest doctor --pretty
```

Expected on this machine: `✓ CLI`, `✓ MCP endpoint reachable`, `✓ CLI
credential`, `✓ Authenticated call`, every harness line `harness not installed`.
Last group fine. Not breakage.

Real proof = live call. Run one `search query`. Quote returned title plus one
number from snippet. `✓ Authenticated call — listRuns succeeded` prove key
works, say nothing about search quality.

## Agent rules

1. Never echo key into chat, commits, logs, or tool output. Read into variable,
   pass through. Do not `cat` the JSON.
2. `doctor` credential fail after correct call: suspect export form first, key
   second.
3. Live `search query` return results → TinyFish work. Stop. Do not run
   `connect`, reinstall, or ask user to restart pi waiting for MCP tools pi
   cannot load.

## Other harnesses

`connect --all` register MCP server for claude-code, codex, cursor, grok,
hermes, openclaw, opencode. Not pi. Run only when user ask to wire those. Read
`connect --help` first. Machine without any of them installed: writes nothing.
