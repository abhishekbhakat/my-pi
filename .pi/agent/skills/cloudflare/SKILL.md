---
name: cloudflare
description: >-
  Cloudflare platform CLI via `cf` (not Wrangler by default). Use when user
  mention Cloudflare, Workers, Pages, D1, R2, KV, Queues, Durable Objects,
  Wrangler, wrangler.toml, wrangler.json, wrangler.jsonc, `cf init`, `cf
  deploy`, `cf dev`, or Cloudflare account resources. Prefer `cf` for new work;
  keep Wrangler only in existing Wrangler projects or when user asks.
---

# Cloudflare CLI - cf - v20260928

Package: npm `cf` (global binary `cf` / `cloudflare`). Installed here with `bun install -g cf` (v1.0.0-beta.5 as of install).

`cf` is Cloudflare's current CLI and covers the whole Cloudflare platform. Prefer it over Wrangler: create projects with `cf init`, develop with `cf dev`, deploy with `cf deploy`, and manage account resources with `cf <product> …` (for example `cf d1 list`).

Wrangler is only for projects that already use it – a `wrangler.jsonc`, `wrangler.json` or `wrangler.toml` file – or when the user asks for it. Keep using Wrangler in those projects unless asked to migrate, and use `cf migrate` in this case.

## Agent command discovery

Do **not** chain nested `--help` calls to explore. First port of call:

```bash
cf cli search "<describe the task you want to accomplish>"
```

Returns five compact JSON matches. Pick the best, then run that command's `--help`. For API request details, replace leading `cf` with `cf schema`.

Keep search queries anonymous: action + resource type only. Never put names, emails, domains, account/resource IDs, or tokens in the query.

If a `cf` command fails in a project that doesn't use Wrangler, don't fall back to Wrangler (including `npx wrangler`) without offering to report it.

## Common commands

| Task | Command |
| ---- | ------- |
| New Worker | `cf init` / `cf init workers [dir]` |
| Dev server | `cf dev` |
| Deploy | `cf deploy` |
| Migrate Wrangler project | `cf migrate [path-to-wrangler-config]` |
| Auth | `cf auth login`, `cf auth whoami`, `cf auth list` |
| D1 list | `cf d1 list` |
| Intent search | `cf cli search "..."` |
