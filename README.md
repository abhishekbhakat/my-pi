# my-pi

Source of truth for this machine's [pi](https://github.com/badlogic/pi-mono) agent config. Edit files under `.pi/agent/` here, then install them into the live `~/.pi/agent` tree.

The `pi` CLI is bun global. `make install` runs `scripts/setup-bun.mjs` (install bun from bun.sh if missing, prepend `~/.bun/bin` for that process), uninstalls npm global `@earendil-works/pi-coding-agent` if present, then `bun install -g` when the bun copy is missing. Config copy still uses Node. Extension `node_modules` use bun when bun is available, else npm. Live config path is `~/.pi/agent`.

`make install` first runs `make restore-bun-pi`, which undoes any earlier vendor-installer layout that replaced bun's `pi` with a Rust binary.

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

- `runinfra/glm-5-3-flash`
- `google/gemini-3.8-flash`

`meta/muse-spark-1.3-contributor` uses `https://api.meta.ai/v1` (`openai-responses`) at 500000. You keep full windows elsewhere, such as `commandcode/z-ai/glm-5.3-flash` at 1048576. Edit the values in `models.json`, then run `make install` and `/reload` in pi.

## Setup

Interactive bootstrap for a new machine or fresh clone. It asks which providers you use, stores API keys in repo `.pi/agent/auth.json` (gitignored, mode 600), and writes personalization as an untracked overlay:

```bash
make setup
```

- **No lasting git branch.** Setup refuses if tracked `.pi/agent` files are dirty (`auth.json` ignored), applies your answers, writes `userprofile.patch` at the repo root (gitignored), then restores tracked `.pi/agent` files to `HEAD`. `auth.json` stays untracked.
- `make install` copies through a temp staging dir and applies `userprofile.patch` there. Your checkout stays clean so you can `git pull` on main. If the patch no longer applies, install aborts and tells you to run `make setup` again.
- Escape hatch: `make install ARGS="--no-profile"`.
- Yes/no prompts default to `n`. Existing keys kept on Enter. Keys never echoed.
- Needs a TTY. `make setup ARGS="--help"` prints usage.
- End offers optional install (default `n`), then `/reload` and `/login` hints.

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

See [AGENTS.md](AGENTS.md). Short version: edit this repo (or run `make setup` for `userprofile.patch`), run `make install`, then `/reload` in pi.
