---
name: zvec-grep
description: >-
  Local-first hybrid workspace search (BM25 + vector + managed ripgrep) via the
  `zg` CLI from @zvec/zvec-grep. Use when wording or location is unknown, when
  the task needs semantic, fuzzy, cross-file, or design-rationale discovery in
  the current repo, when user says zg / zvec-grep / semantic code search /
  "find where X happens", or when native grep thrash on concept-only queries.
  Prefer native grep/rg for exact symbols, paths, quotes, keys, and regex.
  pi has no MCP client — always call `zg` from the shell; never wait for MCP
  tools or run `zg install` for pi.
keywords:
  [
    zg,
    zvec-grep,
    zvec,
    semantic search,
    hybrid search,
    codebase search,
    BM25,
    vector search,
    index,
    ripgrep,
  ]
homepage: https://github.com/zvec-ai/zvec-grep
---

# zvec-grep (`zg`)

Local hybrid search over the workspace: ranked lexical (FTS/BM25), vector, and
managed ripgrep behind one CLI. Index stays under `<root>/.zvec-grep/`. Default
embedding is local (no cloud).

Verified package: `@zvec/zvec-grep` (bin `zg`). Requires Node.js 22+.

## Pi constraint

pi ships no MCP client. Path is always the shell CLI:

```bash
zg status
zg query "..."
zg query --rg -F "ExactSymbol" src
```

Do **not**:

- run `zg install` / `zg uninstall` for pi (targets are codex, claude, qwen,
  qoder, opencode, cursor only)
- wait for MCP tools named `zvec_grep_*` to appear after `/reload`
- treat missing MCP as a broken install

Other harnesses: only run `zg install --target ...` when the user asks to wire
those agents.

## When to use

| Intent | Tool |
| --- | --- |
| Exact word, quote, symbol, key, path, filename, regex, exhaustive hits | Native `grep` / `rg`, or `zg query --rg` |
| Wording or location unknown; semantic / fuzzy / relationship / why / cross-file synthesis | `zg query` (hybrid) |
| Known anchors plus broader context | `zg query` first, then native grep on the hits |
| Open-world fact, news, web | octen-search / tinyfish — not zg |

Concept probe with no exact anchor: **one** focused `zg query`, stop if hits
are irrelevant. Do not spam rephrases.

Exact anchors stay on the exact route even when zg is installed.

## Prerequisites

```bash
# once per machine
npm install -g @zvec/zvec-grep

zg version
# expect 0.2.x or newer
```

Missing binary: install global package, then continue. Do not ask the user to
index by hand if the agent can do it.

## Index lifecycle

Index lives at `<workspace>/.zvec-grep/` (gitignored). Agent owns check +
build for the current workspace.

```bash
cd <workspace-root>
zg status --check-ready
# exit 0 = ready; non-zero = need index or repair
```

First index (default local code model):

```bash
zg index --embedding local/potion-code-16m-v2
```

Or set a machine default once:

```bash
zg config model set local/potion-code-16m-v2 --default
zg index
```

| Command | When |
| --- | --- |
| `zg index` | Create or incremental update |
| `zg index --rebuild --embedding <model>` | Change model or full rebuild |
| `zg index --drop --yes` | Delete index — confirm with user first |
| `zg status` | Coverage, embedding, queue, next action |

Scope large trees early:

```bash
zg index --embedding local/potion-code-16m-v2 \
  -g "src/**" -g "docs/**" -g "!dist/**" -t ts
```

Refresh: indexed `zg query` can refresh by policy (`--refresh background|wait|off`).
After big local edits, prefer `zg index` or query with `--refresh wait` when
stale hits matter.

Never silently create, rebuild, or drop an index on a machine/workspace the
user did not point at. Current session cwd / stated project root only.

## Search commands

Default agent output is compact markdown (good for tool results). Add
`--human` only for user-facing terminal dumps.

### Hybrid (default)

Natural language or mixed intent. Needs a ready index.

```bash
zg query "where theme preferences are restored on startup"
zg query "how auth middleware validates expiry" --limit 8
zg query "install merges api_key into live auth" --preview short
```

### Lexical / vector groups

```bash
zg query --fts "AuthService" -g "src/**" -t ts
zg query --vector "where user preferences are restored" --limit 5
zg query --hybrid "auth flow" --fts "verifyToken" --fuse --limit 10
```

`--fuse` merges groups into one ranked list. Without it, results stay grouped
and a hit can appear in more than one group.

### Managed ripgrep (no index required)

```bash
zg query --rg -F "loadTheme" -g "*.ts" src
zg query --rg -i -C 2 -g "*.md" "make install"
zg query --rg -n "TODO|FIXME" src
```

Use when exhaustive or exact match is the goal. Same compact formatting as
indexed search.

### Useful filters

| Flag | Role |
| --- | --- |
| `--limit <n>` | Max hits per group (default 7; keep small) |
| `--preview none\|short\|full` | Indexed snippet size (default none; short is usually enough) |
| `-g` / `--iglob` | Path include; `!` prefix excludes |
| `-t` / `-T` | ripgrep file type include/exclude |
| `--symbol-type` | `module` `class` `interface` `function` `value` `alias` |
| `--prefer-symbol` | Prefer exact indexed symbols |
| `--modified-after` / `--modified-before` | Time bounds |
| `--mode direct\|server\|auto` | Transport (default auto) |
| `--debug` / `--trace` | Diagnostics on stderr / per-hit trace |

## Read hits

Results name `path:start-end` and optional `matched:` lines. Next step is
always a targeted file read around that range — do not re-dump the whole file
unless the slice is insufficient.

Example shape:

```text
#1 matchedBy=fts+vector src/theme/use-theme.ts:12-36
matched: 16-18
source:
15  export function useTheme() {
16    const [theme, setTheme] = useState("light");
```

Cite path and line range when answering from hits.

## Embedding models

Prefer **local** models. Content and queries stay on disk.

| Need | Model |
| --- | --- |
| Fast first code index (default) | `local/potion-code-16m-v2` |
| English docs / prose | `local/potion-retrieval-32m` |
| Multilingual docs | `local/potion-multilingual-128m` |
| Stronger code transformer | `local/jina-embeddings-v2-base-code` |
| Long English docs | `local/gte-modernbert-base` or `local/nomic-embed-text-v1.5` |

Full catalog: `zg help models`. File types and extractors: `zg help file-types`.

Remote Qwen models need provider credentials **and** explicit workspace
authorization. Do not enable remote embedding unless the user asks.

```bash
# only when user wants remote
zg config provider set qwen --api-key "$DASHSCOPE_API_KEY"
zg auth grant --capability embedding --scope workspace
# or one-shot: zg index --embedding qwen/text-embedding-v4 --allow-remote
```

`zg auth status` / `zg auth revoke` manage grants. Grants live in
`.zvec-grep/authorization.json`.

## Server mode

Optional shared daemon (loopback MCP for other agents). CLI works without it
(`direct` / `auto`).

```bash
zg server status --check-ready
zg server on          # background daemon
zg server off
```

pi does not consume the MCP endpoint. Leave server alone unless user wants it
for another client or faster repeated server-mode queries.

## Agent rules

1. Route exact anchors to native grep/`zg query --rg`. Use indexed `zg query`
   for unknown location and semantic synthesis.
2. Run from workspace root (or pass absolute root where the CLI accepts it).
3. On missing index: `zg status`, then `zg index --embedding local/potion-code-16m-v2`.
4. Default `--limit` 5–10. Raise only when first page is clearly useful.
5. Prefer `--preview short` when snippets help; skip full dumps.
6. One concept probe, then stop if noise. Do not loop reworded queries.
7. Never print API keys. Never pass `--api-key` in chat logs.
8. Never `zg index --drop` without explicit user confirm.
9. Never `zg install` for pi. Never block on MCP tool registration.
10. `.zvec-grep/` is machine-local cache — keep it gitignored; do not commit.

## Quick failure map

| Symptom | Fix |
| --- | --- |
| `zg: command not found` | `npm install -g @zvec/zvec-grep` (Node 22+) |
| status: index not configured | `zg index --embedding local/potion-code-16m-v2` |
| indexed query fails / empty after edits | `zg index` or `--refresh wait` |
| remote embedding blocked | stay local, or user grants via `zg auth grant` / `--allow-remote` |
| wants MCP tools inside pi | explain CLI-only path; offer `zg install` only for other harnesses |

## Docs on disk

Installed package docs (after global npm install):

```text
$(npm root -g)/@zvec/zvec-grep/docs/
  01-agents.md  02-cli.md  03-mcp.md  04-pipeline.md
  05-architecture.md  06-server.md  07-embedding.md
```

Upstream: https://github.com/zvec-ai/zvec-grep
