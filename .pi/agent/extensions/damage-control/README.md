# damage-control

Blocks risky tool calls before they run. Rules live in `rules.yaml` next to this extension (installed to `~/.pi/agent/extensions/damage-control/rules.yaml`), with an optional per-project `.pi/damage-control-rules.yaml` override, and cover destructive bash patterns, zero-access paths, read-only paths, and no-delete paths. Rules flagged `ask: true` prompt for confirmation instead of blocking outright. Every block or confirmation is appended to the `damage-control-log` session entry.

## Commands

`/yolo` toggles YOLO mode. Subcommands: `on`, `off`, `status`. Bare `/yolo` flips the current state.

- YOLO off (default): every tool call is checked against the loaded rules.
- YOLO on: all checks are skipped and every tool call is allowed. The footer shows `yolo` bright; when off it shows dimmed next to `fast` and `intent`.

State persists in `extensions/yolo.json`, so the toggle survives `/reload` and restarts. Turning YOLO on prints a warning. Run `/yolo off` to re-enable the guardrails.

## Files

- `index.ts` — rule matching and the `tool_call` guard.
- `yolo.ts` — YOLO state and the `/yolo` command.
