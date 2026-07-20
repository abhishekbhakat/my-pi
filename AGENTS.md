# Agent rules for my-pi

## Never touch `~/.pi` directly

- Do **not** create, edit, copy, move, or delete anything under `~/.pi` (including `~/.pi/agent/`).
- Do **not** use `cp`, `rsync`, `ln`, redirects, or editors against `~/.pi/**`.
- The only way to install or update the live agent config is:

```bash
./install.sh -y
```

On Windows, use the native PowerShell equivalent instead of `install.bat`:

```powershell
.\install.ps1 -y
# or, if execution policy blocks it:
powershell -ExecutionPolicy Bypass -File .\install.ps1 -y
```

Optional flags:

```bash
./install.sh -y           # overwrite protected config without prompting (default)
./install.sh -h <host>    # set models.json proxy host
./install.sh              # interactive mode (prompt before overwriting protected files)
```

## Edit only the repo source

All agent config lives under this repository:

```text
.pi/agent/
```

Examples:

- extensions: `.pi/agent/extensions/`
- skills: `.pi/agent/skills/`
- themes: `.pi/agent/themes/`
- settings/models: `.pi/agent/settings.json`, `.pi/agent/models.json`, etc.

After changing source files, run `./install.sh -y`.

## After install

Tell the user to run `/reload` or `/restart` inside pi so the running session picks up changes. Do not attempt to mutate the live `~/.pi` tree yourself.
