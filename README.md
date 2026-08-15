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

`auth.json` is merge-only: repo keys override, live-only keys stay. Keep it gitignored.

## Sync

Pull current live `~/.pi` state back into the repo:

```bash
make sync
```

Default is additive (update and add only), so repo-only work is not wiped when live lags. Pass `-p` only when you want a live mirror:

```bash
make sync ARGS="-p"
```

Sync skips runtime files (`bin/`, `sessions/`, `node_modules`, `package-lock.json`). `auth.json` is merge-only both ways.

## Rules

See [AGENTS.md](AGENTS.md). Short version: edit this repo, run `make install`, then `/reload` in pi.
