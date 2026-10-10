# Source

Vendored from [tarwin/tinyjsapp](https://github.com/tarwin/tinyjsapp) (MIT).

Upstream path: `skill/` (`SKILL.md` + `references/`).

Pinned commit: `8336e31d5d03329051b13284730d98f9ec2682ca` (main tip, 2026-10-11).
Upstream skill states current release **0.50.1** (tag `v0.50.1` =
`2ea9f0ef7e83a4962adaaa78d4590c412e9f87a9`). Note: `references/api.md`
header still says "as of tinyjs 0.44.0"; treat SKILL.md release line as
source of truth until upstream refreshes that header.

## Local modifications

- Frontmatter: longer `description`, `keywords`, `homepage` for pi skill
  matching. Keep `name: tinyjs`.
- `<!-- pi-local -->` notes block after frontmatter (project-local skill
  preference, CLI install ask-first, version check).
- Everything else under `SKILL.md` and `references/` is verbatim upstream.
- `LICENSE` copied from repo root (MIT, Copyright 2026 Tarwin Stroh-Spijer).

## Refresh

1. Resolve SHA: `git ls-remote https://github.com/tarwin/tinyjsapp main`
2. Fetch into a fresh temp dir from
   `https://raw.githubusercontent.com/tarwin/tinyjsapp/<sha>/skill/...`
3. Diff against `.pi/agent/skills/tinyjs/`
4. Replace `SKILL.md` + `references/`, re-apply frontmatter + `pi-local`
   block
5. Bump SHA / date / release in this file; refresh `LICENSE` if changed
6. `make install`, then `/reload` or `/restart` in pi
