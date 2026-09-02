# Scope / Backlog

Jot ideas here. Pick up later. No structure needed unless it helps.

Format: `- [ ] <idea>` (check off when done)

## Backlog

- [x] Auto-compaction continuity: when auto-compaction triggers mid-task, the running task is aborted, compaction runs, then the session just sits idle. Add a mechanism to resume/continue the interrupted task after compaction completes (carry over the in-flight intent/state so work picks up where it left off).
- [x] Auto-compaction at 75% usage should NOT abort a running command. If a command is in-flight when the threshold is hit, let it finish before triggering compaction (or defer compaction until the command completes). Aborting mid-command loses partial output and breaks state.
