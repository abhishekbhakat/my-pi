# claude-code-pi

Pi provider `claude-code-cli`. Each model turn runs local `claude -p`. No Anthropic SDK and no HTTP fallback.

Each Pi session maps to one Claude Code session UUID. Map files live at `$PI_CODING_AGENT_DIR/claude-code-pi/sessions/<piSessionId>.json` (default `~/.pi/agent/...`).

## Layout

```text
claude-code-pi/
  index.ts      register provider, /claude-code-pi, session_start
  models.ts     aliases (sonnet, opus, fable) and CLAUDE_CODE_PI_MODELS
  sessions.ts   Pi id ↔ Claude UUID, prefix hash, resume eligibility
  cli.ts        claude binary, argv (--session-id / --resume / stateless)
  blockCall.ts  ```pi-tool-call fenced YAML block parse/render
  prompt.ts     transcript dump, delta dump, tool-call block parse
  stream.ts     streamSimple: pick seed vs resume vs stateless, spawn
  README.md
```

## Session map

1. `session_start` stores the active Pi session id.
2. First turn for that id: `--session-id <uuid>` and full prompt. On exit 0, record `initialized` and a hash of the messages sent.
3. Later turns whose message prefix matches that hash: `--resume <uuid>` and only new messages.
4. Helper tools and `/undo` that do not match the prefix: `--no-session-persistence` and a full dump. The map file is left alone.

Claude Code tools stay off (`--tools ""`). When Pi offers tools, the bridge teaches ```pi-tool-call fenced YAML blocks (see `blockCall.ts`) and Pi executes them. The fence body is YAML: `name` plus `arguments`; multiline strings (shell commands, file contents) are raw `|` block scalars, so no JSON or quote escaping is ever needed. Legacy `<pi_tool_call>` JSON tags still parse for sessions that started under the old format. Tool-free callers (capability helpers, cache warmup) get a plain-text bridge and never parse tool-call blocks into `toolUse`.

Bridge rules are sent with `--system-prompt` (full replace) on every invocation, replacing Claude Code's harness prompt. The per-turn user prompt carries only the Pi system prompt, the current tool list, the transcript, and a one-line footer reminding the tool-call block format. Snapshot default `on` records the first render per conversation; passing the flag every turn keeps post-compact renders ours.

## /claude-refresh

`/claude-refresh` rotates the Claude Code session UUID for the active Pi session, resets the mirror's sync state, and deletes the old session's transcript file under `<configDir>/projects/<munged-cwd>/<uuid>.jsonl` (default `~/.claude`). The next model turn runs in seed mode: a brand-new Claude Code session with the full current Pi transcript. Use it after reverting work in Pi (for example with `/undo`) when the mirrored Claude session should forget everything, including its own stray state. Nothing is left behind on disk. Sibling files (for example the project `memory` directory) are never touched, and automatic reseeds (session loss, prefix breaks) rotate without deleting so Claude Code keeps its own history for those paths.

Thinking: Pi's level maps to `--effort`. When a level is on, the bridge also passes the hidden `--thinking-display summarized`. Without it, `claude -p` stream-json returns signature-only thinking blocks with empty text, so Pi has nothing to show.

## Env

| Variable                      | Role                                      |
| ----------------------------- | ----------------------------------------- |
| `CLAUDE_CODE_PI_BIN`          | Claude executable. Default `claude`.      |
| `CLAUDE_CODE_PI_MODELS`       | Aliases. Default `sonnet,opus,fable`.     |
| `CLAUDE_CODE_PI_TIMEOUT_MS`   | Per-turn timeout. Default 300000.         |
| `CLAUDE_CODE_PI_CONTEXT_WINDOW` | Advertised window. Default 1000000.     |

Before starting `claude`, the bridge removes Anthropic API key, auth token, base URL, custom header and Bedrock/Vertex/Foundry variables from the environment, so every turn uses the Claude Code login.

`claude-code-models-env.ts` still pins `claude-fable-5-1` before this provider loads.

## Commands

`/claude-code-pi status|models|test|help`

## Install

Repo copy is this folder. After `make install`, drop `npm:claude-code-pi` from `settings.json` so only one `claude-code-cli` provider registers. Then `/reload`.
