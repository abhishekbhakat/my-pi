# my-pi

Source of truth for this machine's [pi](https://github.com/badlogic/pi-mono) agent config. Edit files under `.pi/agent/` here, then install them into the live `~/.pi/agent` tree.

Do not edit `~/.pi` by hand. Install is the only write path into the live agent.

## Layout

```text
.pi/agent/extensions/   extensions (intent-router, tools, widgets)
.pi/agent/skills/       skills
.pi/agent/themes/       themes
.pi/agent/settings.json
.pi/agent/models.json
AGENTS.md               rules for agents working in this repo
```

## Context window caps

You cap seven models at 262144 in `.pi/agent/models.json` to reserve headroom for tool and reasoning overhead:

- `runinfra/deepseek-v4-flash`
- `runinfra/glm-5-3-flash`
- `google/gemini-3.8-flash`
- `xai/grok-4.5` (modelOverrides)
- `xai/grok-4.6` (modelOverrides)
- `opencode/muse-spark-1.3-contributor-free`
- `commandcode/meta/muse-spark-1.3-contributor`

You keep full windows elsewhere, such as `commandcode/z-ai/glm-5.3-flash` at 1048576. Edit the values in `models.json`, then run `make install` and `/reload` in pi.

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

See [AGENTS.md](AGENTS.md). Short version: edit this repo, run `make install`, then `/reload` in pi.
