# Agent rules for my-pi

## Never touch `~/.pi` directly

- Do **not** create, edit, copy, move, or delete anything under `~/.pi` (including `~/.pi/agent/`).
- Do **not** use `cp`, `rsync`, `ln`, redirects, or editors against `~/.pi/**`.
- The only way to install or update the live agent config is:

```bash
make install
```

Same command on Windows. Or call Node directly:

```bash
node scripts/pi.mjs install
```

Optional flags:

```bash
make install                  # overwrite protected config
make install ARGS="-h HOST"   # set models.json proxy host
make help                     # list targets
```

## Edit only the repo source

All agent config lives under this repository:

```text
.pi/agent/
```

Examples:

- extensions: `.pi/agent/extensions/`
- skills and themes: `.pi/agent/skills/`, `.pi/agent/themes/`
- global instructions: `.pi/agent/AGENTS.md`
- system replacement: `.pi/agent/SYSTEM.md`
- settings/models: `.pi/agent/settings.json`, `.pi/agent/models.json`, etc.

After changing source files, run `make install`. Install also merges repo `.pi/agent/auth.json` into `~/.pi/agent/auth.json` (repo keys override, live-only keys stay).

## Sync live config back into the repo

To pull current live `~/.pi` state into this repository (reverse of install):

```bash
make sync
```

Or:

```bash
node scripts/pi.mjs sync
```

Optional flags:

```bash
make sync             # overwrite protected config in the repo
make sync ARGS="-p"   # also delete repo files missing from live (mirror/prune)
```

Sync copies extensions, skills, themes, and root config files. **Default is additive** (update/add only) so repo-only work is never wiped when live lags. Pass `-p` only when you intentionally want a live mirror. It skips runtime files (`bin/`, `sessions/`, `node_modules`, `package-lock.json`). `auth.json` is merge-only both ways: incoming provider keys override, destination-only keys stay, nothing is deleted. Keep `auth.json` gitignored.

## After install

Tell the user to run `/reload` or `/restart` inside pi so the running session picks up changes. Do not attempt to mutate the live `~/.pi` tree yourself.
