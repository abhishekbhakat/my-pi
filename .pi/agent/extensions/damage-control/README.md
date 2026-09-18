# damage-control

Blocks risky tool calls before they run. Rules live in `rules.yaml` next to this extension (installed to `~/.pi/agent/extensions/damage-control/rules.yaml`), with an optional per-project `.pi/damage-control-rules.yaml` override, and cover destructive bash patterns, zero-access paths, read-only paths, and no-delete paths. Rules flagged `ask: true` prompt for confirmation instead of blocking outright. Every block or confirmation is appended to the `damage-control-log` session entry.

## Commands

`/yolo` toggles YOLO mode. Subcommands: `on`, `off`, `status`. Bare `/yolo` flips the current state.

The `yolo` tool is status-only: its description is ON or OFF. Execute does nothing useful. After toggle, `/reload` so the description matches.

- YOLO off (default): every tool call is checked against the loaded rules.
- YOLO on: all checks are skipped and every tool call is allowed. The footer shows `yolo` bright; when off it shows dimmed next to `fast` and `intent`.

State is per session id in `extensions/yolo.json` (`sessions.<id>: true`). Other sessions stay off. Toggle survives `/reload` and resume of that session. Legacy `{ "enabled": true }` is ignored. Sessions with no id (`--no-session`) keep the flag in memory only. `/delete` and `/xdelete` drop that id. Writes also drop ids whose `.jsonl` is gone under `sessions/`. Resume-picker deletes are cleaned on the next write. Turning YOLO on prints a warning. Run `/yolo off` to re-enable the guardrails.

## Files

- `index.ts` — rule matching and the `tool_call` guard.
- `yolo.ts` — YOLO state and the `/yolo` command.
