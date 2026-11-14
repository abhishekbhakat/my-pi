# Background coding and helpers

Use `/coder` to toggle the `coder` tool. `/coder on`, `/coder off`, and `/coder status` set or inspect its state. Coder starts enabled on fresh sessions, like other direct capability tools. `/capability` toggles the other capabilities without changing coder.

The driver keeps its selected model. Configure the delegate in `capabilities/coder.md`; its default is `anthropic/claude-opus-5-5` with `medium` reasoning. The default driver remains `anthropic/claude-sonnet-5-5`. `make setup` offers separate coder model and effort choices and saves them as `capabilities.coder` in `userprofile.json`. Install applies that preference to coder frontmatter without changing the driver. Older profiles without a coder entry keep the repository coder default. If Opus is not enabled during setup, select another enabled model. The coder tool launches a separate Pi process in the current working directory and returns a run ID. It writes files directly into that directory. Only one coder run may execute at a time. Give it bounded paths and acceptance checks. While it runs, the driver may read or plan, but must avoid editing the assigned files.

## Context and permissions

At invocation, coder copies the entire active session branch into a private child session file, including image messages, custom entries, compaction records and context edits. It adds placeholder results for pending parent tool calls so the child starts with a valid transcript. It also receives the parent's effective system prompt and the coder instructions. This extension does not truncate that snapshot. Pi's normal projection and model context limits still apply, including existing compaction. Abandoned branches are not part of the snapshot.

The child loads the usual Pi extensions, including permission guards, enables `codemode`, and keeps normal skill discovery enabled. Calls from codemode use the same tool validation and permission hooks as direct calls. It also receives the parent skill list through the inherited system prompt. Coder instructions require reading `coding/SKILL.md` and relevant stack skills before implementation. It cannot call capability delegates or MCP tools. Coder runs through Pi RPC. The parent declines child approval and input dialogs, shows the block in the live widget, and leaves the driver to handle it. Coder does not receive extra permissions. Child shell jobs wait for completion before coder can finish. The child inherits branch-recorded YOLO state but does not enable it. `yolo` is a read-only status tool.

## Live collaborative coder

Coder streams text, thinking summaries when available, tool arguments, and tool activity into an editor widget. The widget keeps a short tail and repaints at most four times per second. Full progress stays in `progress.log`; raw child events stay in `stdout.jsonl`. No progress updates enter the chat transcript or wake the driver.

- `/coder-send <instruction>` sends instructions to the active coder without changing its toggle. Coder receives them after its current assistant turn and tool calls. The widget distinguishes sending, queued, delivered, and rejected instructions. Queued means accepted for delivery, not applied.
- `/coder-send --interrupt <instruction>` aborts the current assistant turn and its active tools, then sends the instruction in the same child session. This can cancel other tool calls from that turn. Edits already written remain on disk. Coder keeps earlier context and receives any queued messages before the new instruction. An idle interrupt still sends the instruction.
- `/coder-stop` cancels the active coder. Edits already written remain on disk.
- `capability_jobs` with `action: "steer"`, `id`, and `message` lets the driver forward instructions. Add `interrupt: true` to interrupt first. Both forms require a non-empty message. Only coder runs accept steering.
- `capability_jobs output` shows coder progress while running, labelled `PARTIAL - not a result`. Wait for completion before treating output as a verified change or final report.

Child foreground bash uses Pi's closed stdin and a 180-second default timeout. The child applies a 180-second minimum to explicit shorter values and preserves longer timeouts. The guard also covers nested bash calls from codemode. Background shell jobs keep their separate lifecycle; use `jobs stop` for those jobs.

Plain chat messages still go to the driver. Use `/coder-send` to address coder directly, or ask the driver to forward a message. Existing runs started before installing this version do not gain live controls. Reload cancels them; start a new run afterward.

## Background reviews and reasoning

`reasoning_coach`, `patch_reviewer`, and `/patch-review` return before their models finish. They retain their existing model configuration and context assembly. Conversation and system prompt snapshots come from invocation time; file and Git context come from background context assembly. Treat a review as potentially stale if files change while it runs. Other capabilities and `/commit-message` keep their existing blocking behavior.

Coach and reviewer stream into read-only live widgets, including reviews launched with `/patch-review`. Each concurrent run shows its own name, phase, and latest preview. `capability_jobs output` returns their progress as `PARTIAL`; only coder accepts steering.

Completion posts a result into the originating chat and wakes the driver. In the terminal, `capability_result` appears as a single-line summary. Click it or use Ctrl+O to expand the report, then click again to collapse. Collapsing changes presentation only; the driver still receives the result content. When the driver is busy, the result enters as a follow-up. Do not assume a review verdict or planning decision before the result arrives.

Use `capability_jobs` with `action: "list"`, `action: "output"` plus `id`, or `action: "stop"` plus `id`. These runs use a separate registry from shell `jobs`. Up to four capabilities may run at once. `/coder off` hides coder but leaves existing runs alone.

Session switches, forks, tree navigation, shutdown and reload cancel running capabilities and suppress delivery to another branch or session. Cancellation keeps edits already written. Coder receives SIGTERM so Pi can abort active tools and stop shell jobs. Cleanup has no guessed execution deadline.

Run data stays under `.agents/capability-runs/<id>/`. The registry creates a local `.gitignore` there to keep run files out of Git. Child session files contain conversation context; treat them as private and do not commit or share them. Full reports remain in `result.txt`; chat delivery keeps the last 16,000 characters. Coder also writes `stdout.jsonl`, `report.txt`, and `stderr.txt`. It detects completion from Pi's RPC `agent_settled` event, validates the last assistant stop reason, then sends SIGTERM so lingering workers cannot delay delivery. Completed in-memory entries have a 50-run limit. Process crashes do not guarantee completion delivery; inspect saved files after a crash.

After editing repository configuration, run `make install`, then `/reload` or `/restart` in Pi.
