---
name: fsearch
description: >-
  macOS whole-disk fuzzy file finder + indexed content search via the
  `fsearch` CLI (daemon-backed, ~0.1 ms name lookup, typo-tolerant). Use when
  file location is unknown and outside current repo ("where is that file",
  "find X anywhere on my Mac", recent/large files by type/size/mtime, where
  symbol defined across projects). Prefer rg/grep for exact or exhaustive
  in-repo search, zg for semantic in-repo discovery. macOS only.
keywords:
  [
    fsearch,
    file search,
    find file,
    whole disk,
    fuzzy,
    spotlight,
    locate,
    mtime,
    size,
    macOS,
    daemon,
  ]
homepage: https://github.com/noahdunnagan/fsearch
---

# fsearch

Whole-disk index for macOS: fuzzy typo-tolerant names, plus content via
`grep:` / `regex:` / `sym:`. CLI talks to a small daemon (starts on demand).
Upstream: https://github.com/noahdunnagan/fsearch (MIT, Rust, v0.1.0).

Verified against upstream `main` (`src/main.rs` USAGE). Binary not assumed
present until user installs it.

## When to use

| Intent | Tool |
| --- | --- |
| File somewhere on the Mac, location unknown | `fsearch` |
| Filter by type / size / age across disk | `fsearch` |
| Exact / exhaustive hits in current repo, refactors, prove absence | `rg` / `grep` |
| Concept / "where does X happen" in current repo | `zg query` (zvec-grep) |
| Non-macOS host | `rg` / `find` — fsearch n/a |

## Install (do not run unless user asks)

Missing binary: tell user. Do **not** clone, `cargo build`, or `fsearch install`
unasked. First index is heavy (~50 s, ~0.9 GB peak RAM; content index can be
hundreds of MB).

```bash
command -v fsearch || echo "fsearch missing — ask user to install"
```

When user asks to install (Rust toolchain required):

```bash
git clone https://github.com/noahdunnagan/fsearch && cd fsearch
cargo build --release
./target/release/fsearch install          # copy -> ~/.local/bin/fsearch
./target/release/fsearch install --login  # also start daemon at login (LaunchAgent mt.nd.fsearch)
```

Ensure `~/.local/bin` is on `PATH`. Grant Full Disk Access to
`~/.local/bin/fsearch` in System Settings > Privacy & Security (again after
each rebuild). Without FDA, protected folders are skipped silently — user
grants this, agent never scripts around TCC.

```bash
fsearch uninstall   # remove login agent; keeps index
```

Index / socket live under `~/Library/Application Support/FSearch/`.

## Commands

```bash
fsearch '<query...>'           # search; starts daemon if needed; prints paths
fsearch '<query...>' --json    # raw JSON response line
fsearch status                 # daemon/index status (JSON)
fsearch stdio                  # JSON lines on stdin/stdout
fsearch serve                  # run daemon in foreground
fsearch bench '<query...>'     # time query in-process against saved index
```

Default human output: one absolute path per hit. Prefer `--json` when the
agent must parse structured hits.

stdio / socket ops (from README):

```json
{"q": "fsearch main", "limit": 20}
{"op": "grep", "pattern": "apply_dir", "in": "~/Developer"}
```

## Queries — always single-quote

Unquoted `>` / `<` is a **shell redirect** (creates a stray file like `5mb`).
Always wrap the whole query in single quotes.

```bash
fsearch 'main.rs'                          # fuzzy name
fsearch 'readme in:~/Developer'            # scope to folder
fsearch 'type:image size:>5mb mtime:<7d'
fsearch 'ext:rs grep:apply_dir'            # text inside files
fsearch 'ext:rs regex:fn\s+\w+_dir'        # regex inside files
fsearch 'sym:apply_dir'                    # definition site
```

Words are fuzzy; 5+ letter words forgive one typo (`mian.rs` → `main.rs`).
Also: `'exact`, `^prefix`, `suffix$`, `!exclude`.

Filters: `ext:` `type:` `kind:` `in:` `size:` `mtime:` `re:` `path:` `grep:`
`regex:` `sym:` `limit:`. Content search is smart-case.

Verify a top hit with `ls` / `stat` before acting — fuzzy rank can mislead.

## Agent rules

1. Never run `fsearch install`, `cargo build`, login-item changes, or
   `uninstall` unless the user explicitly asks.
2. Not exhaustive: skips some file types plus `build/` and `vendor/`. Use
   `rg` when completeness or prove-absence matters.
3. Empty result ≠ absent. Likely FDA/TCC gap or skipped path — say so.
4. Never `grep:` / `regex:` for secrets, tokens, API keys. Never print
   contents of credential files. Hits under `~/.pi/**` are read-only per
   repo AGENTS.md (no live-home edits via this skill).
5. Narrow first with `in:`, `ext:`, `type:`, `limit:` before widening to
   whole disk.
6. On non-darwin hosts, do not attempt fsearch — fall back to `rg` / `find`
   / `zg`.

## Failure map

| Symptom | Cause | Action |
| --- | --- | --- |
| `command not found` | not installed / `~/.local/bin` off PATH | tell user; do not install |
| `cannot reach daemon` | daemon down / first start failed | `fsearch status`; ask user to restart or `fsearch serve` |
| Missing `~/Library`, Mail, Desktop hits | no Full Disk Access | ask user to grant FDA to `~/.local/bin/fsearch` |
| File exists but not found | skipped type or `build/` / `vendor/` | fall back to `rg` / `find` |
| Stray file named `5mb` etc. | unquoted query | delete it; re-run with quotes |
| Stale / thin results right after install | index still building | wait; `fsearch status`; retry |
| Non-macOS host | unsupported | `rg` / `find` / `zg` |

## Docs

- Upstream README: https://github.com/noahdunnagan/fsearch
- Local help after install: `fsearch --help` (prints USAGE to stderr)
