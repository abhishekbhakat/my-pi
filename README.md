# my-pi

Source of truth for this machine's [pi](https://github.com/badlogic/pi-mono) agent config. Edit files under `.pi/agent/` here, then install them into the live `~/.pi/agent` tree.

The `pi` CLI is bun global. `make install` runs `scripts/setup-bun.mjs` (install bun from bun.sh if missing, prepend `~/.bun/bin` for that process), uninstalls npm global `@earendil-works/pi-coding-agent` if present, then `bun install -g` when the bun copy is missing. Config copy still uses Node. Extension `node_modules` use bun when bun is available, else npm.

Standalone bun bootstrap:

```bash
node scripts/setup-bun.mjs
```

Do not edit `~/.pi` by hand. Install is the only write path into the live agent.

## Layout

```text
.pi/agent/extensions/   extensions (tools, widgets)
.pi/agent/skills/       skills
.pi/agent/themes/       themes
.pi/agent/settings.json
.pi/agent/models.json
AGENTS.md               rules for agents working in this repo
```

## Context window caps

You cap these models at 262144 in `.pi/agent/models.json` to reserve headroom for tool and reasoning overhead:

- `runinfra/deepseek-v4-flash`
- `runinfra/glm-5-3-flash`
- `google/gemini-3.8-flash`

`meta/muse-spark-1.3-contributor` uses `https://api.meta.ai/v1` (`openai-responses`) at 500000. You keep full windows elsewhere, such as `commandcode/z-ai/glm-5.3-flash` at 1048576. Edit the values in `models.json`, then run `make install` and `/reload` in pi.

## Setup

Interactive bootstrap for a new machine or fresh clone. It asks which providers you use, stores API keys in repo `.pi/agent/auth.json` (gitignored, mode 600), rewrites `enabledModels`, and retargets capability-tool models when a preferred provider is off.

```bash
make setup                                  # auto-creates pi-install-<ddmmyyyy> if on main
make setup ARGS="--create-branch <name>"   # or pin a branch name
```

- On `main`, `master`, or detached HEAD, plain `make setup` auto-creates a local branch `pi-install-<ddmmyyyy>` (suffixes `-2`, `-3`... if taken).
- The branch is local only. Setup never pushes or sets an upstream.
- Yes/no prompts default to `n`.
- An existing key is kept if you press Enter.
- Keys are never echoed.
- Setup needs a TTY. `make setup ARGS="--help"` prints usage.
- At the end it offers `make install` (default `n`), then prints `/reload` and `/login <provider>` hints.
- After rebasing onto a newer `main`, capability files may conflict. Resolve them, then re-run setup.

Make does not forward bare flags, so pass options through `ARGS="..."`. Full behaviour is in [SPEC.md](SPEC.md).

## Testing

`make test-setup` runs the setup acceptance cases in Docker with `--network none`. The image is built from a filtered tar of tracked and unignored files. It never bind-mounts the host repo, and it fails if a real `auth.json` would enter the context. `make test-setup ARGS="07-providers"` runs one case. Do not run `setup` on the host as a test.

## Install

Copy the repo into the live agent:

```bash
make install
```

Same command on Windows. Or:

```bash
node scripts/pi.mjs install
```

Optional flags:

```bash
make install                  # overwrite protected config
make install ARGS="-h HOST"   # set models.json proxy host
make help                     # list targets
```

After install, run `/reload` or `/restart` inside pi so the running session picks up the change.

`auth.json`: `api_key` merge-only (repo keys override, live-only keys stay). OAuth (`type: oauth`) never installs repo → home. Keep it gitignored.

## Sync

Pull current live `~/.pi` state back into the repo:

```bash
make sync
```

Default is additive (update and add only), so repo-only work is not wiped when live lags. Pass `-p` only when you want a live mirror:

```bash
make sync ARGS="-p"
```

Sync skips runtime files (`bin/`, `sessions/`, `node_modules`, `package-lock.json`). `auth.json`: `api_key` merge both ways; oauth home → repo only.

## Rules

See [AGENTS.md](AGENTS.md). Short version: edit this repo (or run `make setup` on a local branch), run `make install`, then `/reload` in pi.
