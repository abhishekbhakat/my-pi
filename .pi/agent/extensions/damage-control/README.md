# damage-control

Damage Control checks tool calls before they run. YOLO off is the default. YOLO on skips every check for that session.

## What is hard-blocked

Direct `write` / `edit` and mutating shell targets aimed at system roots, `~/.pi`, credential dirs, Git metadata, secrets, and lockfiles. Redirects into those paths, `sudo`/`env`/`bash -c` wrappers, and glob prefixes are unwrapped first. A narrow same-command `mktemp` / `mktemp -d` cleanup of its own `/tmp` path is allowed. `dd of=/dev/null` is allowed; other device writes are not.

## What Jev decides

Other risk-word shell commands go to Jev 1.13 Free through OpenCode Zen with:

- `guardrails` — short policy text (git writes, `rm -rf`, cloud deletes, SQL drops, pip outside `uv`, …)
- `command` and `cwd`
- `last_user_prompt` — latest human message on the session branch

Two nouls:

1. `violates_guardrails` — does the command break policy?
2. `user_explicitly_requested` — did that user message clearly ask for this command?

If the user score is at least 0.85, the command is allowed. Else if the guardrails score is at least 0.85, Damage Control asks for confirmation. Unavailable or invalid Jev answers also ask; they never count as low risk. Commands that look like they contain credentials are not sent to Jev (treated as unavailable → ask). The API key lives in `../shared/jev-zen.ts`.

## Commands

`/yolo` toggles YOLO for this session: `on`, `off`, `status`. Bare `/yolo` flips state.

The `yolo` tool is status-only. Its description is ON or OFF. Execute does nothing useful. After toggle, `/reload` so the description matches.

- YOLO off: path guards + Jev review run.
- YOLO on: all checks skipped. Footer shows `yolo` bright; when off it is dimmed next to `fast` and `intent`.

State is per session id in `extensions/yolo.json`. Other sessions stay off. No session id (`--no-session`) keeps the flag in memory only.

## Files

- `index.ts` — `tool_call` hook
- `paths.ts` — protected roots and sensitive write paths
- `bash.ts` — parse, wrappers, redirects, mktemp exemption, path guards
- `git.ts` — read-only git detection (skip Jev)
- `semantic.ts` — guardrails text and Jev review
- `user-prompt.ts` — latest user message
- `yolo.ts` — YOLO state and `/yolo`
- `guards.test.ts` — unit tests (`bun test damage-control/guards.test.ts`)
