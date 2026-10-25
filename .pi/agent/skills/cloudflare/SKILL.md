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

## Zero Trust (tunnels, devices, DNS)

Inventory:

```bash
cf zero-trust devices list          # WARP devices
cf zero-trust gateway rules list    # DNS override + network rules
cf tunnels list                     # All tunnels
cf mesh nodes list                  # WARP Connector tunnels
cf network routes cidr list          # Tunnel routes
cf dns records list --zone <zone>   # Zone DNS
```

Gotchas (hit 2026-10-25):

- Delete fails `1022 active connections` while list shows none. Run `cf tunnels connections cleanup <tunnel-id>` first, stop local cloudflared, then `cf tunnels delete <tunnel-id> --force`.
- Remote ingress has no per-field flags. Use `cf tunnels config update <id> --body '{"config":{"ingress":[{"hostname":"...","service":"http://localhost:..."},{"service":"http_status:404"}]}}'`.
- `cf dns records edit <id> --zone <zone>` takes `--body` JSON only. No `--content` flag.
- Fresh tunnel can reject connectors with `Failed to get tunnel` for ~1 min (propagation). Verify from a second host before recreating.
- Split Tunnel: default device profile may miss the `192.168.0.0/16` exclude, so connector hosts route LAN via WARP and blackhole it (dead CIFS, dead origins). Compare `cf zero-trust devices profiles default get` against `... profiles custom list`, fix with `... default update --exclude '[...]'`. WARP Connector identity uses the default profile, not per-email ones. Policy auto-syncs, no daemon restart needed.
- Windows cloudflared token lives in the service binPath. Rotate with `net stop cloudflared`, `sc config cloudflared binPath= "\"<exe>\" tunnel run --token <token>"`, `net start cloudflared`.
