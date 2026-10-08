# claude-code-pi

Pi provider `claude-code-cli`. Each model turn runs local `claude -p`. No Anthropic SDK and no HTTP fallback.

Each Pi session maps to one Claude Code session UUID. Map files live at `$PI_CODING_AGENT_DIR/claude-code-pi/sessions/<piSessionId>.json` (default `~/.pi/agent/...`).

## Layout

```text
claude-code-pi/
  index.ts        register provider, /claude-code-pi, session_start
  models.ts       aliases (sonnet, opus, haiku, fable) and CLAUDE_CODE_PI_MODELS
  sessions.ts     Pi id ↔ Claude UUID, prefix hash, resume eligibility
  cli.ts          claude binary, argv (--session-id / --resume / stateless)
  blockCall.ts    legacy ```pi-tool-call fenced YAML parse/render
  claudeTools.ts  Anthropic <function_calls> XML parse/render + name maps
  morphRepair.ts  OpenRouter Morph fallback for broken tool XML
  prompt.ts       transcript dump, delta dump, tool-call parse
  stream.ts       streamSimple: pick seed vs resume vs stateless, spawn
  README.md
```

## Session map

1. `session_start` stores the active Pi session id.
2. First turn for that id: `--session-id <uuid>` and full prompt. On exit 0, record `initialized` and a hash of the messages sent.
3. Later turns whose message prefix matches that hash: `--resume <uuid>` and only new messages.
4. Helper tools and `/undo` that do not match the prefix: `--no-session-persistence` and a full dump. The map file is left alone.

Claude Code tools stay off (`--tools ""`). When Pi offers tools, the bridge teaches Anthropic `<function_calls><invoke>…` XML (Claude Code tool names) and Pi executes the translated calls. Legacy ```pi-tool-call YAML fences and `<pi_tool_call>` JSON tags still parse for older sessions. Tool-free callers (capability helpers, cache warmup) get a plain-text bridge and never parse tool-call blocks into `toolUse`.

If the model emits broken tool XML (for example missing the opening `<function_calls>` tag) the local parser still extracts `<invoke>` blocks when it can. When invoke count still exceeds parsed calls, Morph (`morph/morph-v3-fast` via OpenRouter) rewrites the slice once; the result is accepted only when parameter values are verbatim substrings of the source. Morph is default on; set `CLAUDE_CODE_PI_MORPH_REPAIR=0` to disable.

**OpenRouter key is required** for Morph. Why: `claude -p` sometimes emits broken tool XML (missing `<function_calls>`, etc.), so Pi cannot run tools; Morph rewrites that XML. `make setup` asks for the key whenever you enable claude-code-cli, even if you skip openrouter chat models. Without a key Morph stays enabled but inert (`/claude-code-pi status` warns). Key sources: `auth.json` `openrouter.key`, `OPENROUTER_API_KEY`, or `CLAUDE_CODE_PI_MORPH_API_KEY`.

Bridge rules are sent with `--system-prompt` (full replace) on every invocation, replacing Claude Code's harness prompt. The per-turn user prompt carries only the Pi system prompt, the current tool list, the transcript, and a one-line footer reminding the tool-call block format. Snapshot default `on` records the first render per conversation; passing the flag every turn keeps post-compact renders ours.

## /claude-refresh

`/claude-refresh` rotates the Claude Code session UUID for the active Pi session, resets the mirror's sync state, and deletes the old session's transcript file under `<configDir>/projects/<munged-cwd>/<uuid>.jsonl` (default `~/.claude`). The next model turn runs in seed mode: a brand-new Claude Code session with the full current Pi transcript. Use it after reverting work in Pi (for example with `/undo`) when the mirrored Claude session should forget everything, including its own stray state. Nothing is left behind on disk. Sibling files (for example the project `memory` directory) are never touched, and automatic reseeds (session loss, prefix breaks) rotate without deleting so Claude Code keeps its own history for those paths.

Thinking: Pi's level maps to `--effort`. When a level is on, the bridge also passes the hidden `--thinking-display summarized`. Without it, `claude -p` stream-json returns signature-only thinking blocks with empty text, so Pi has nothing to show.

## Env

| Variable                        | Role                                                                 |
| ------------------------------- | -------------------------------------------------------------------- |
| `CLAUDE_CODE_PI_BIN`            | Claude executable. Default `claude`.                                 |
| `CLAUDE_CODE_PI_MODELS`         | Aliases. Default `sonnet,opus,haiku,fable`.                          |
| `CLAUDE_CODE_PI_TIMEOUT_MS`     | Per-turn timeout. Default 300000.                                    |
| `CLAUDE_CODE_PI_CONTEXT_WINDOW` | Advertised window. Default 1000000.                                  |
| `CLAUDE_CODE_PI_MORPH_REPAIR`   | Morph XML repair. Default on. Set `0`/`false`/`no`/`off` to disable. |
| `CLAUDE_CODE_PI_MORPH_MODEL`    | OpenRouter Morph model. Default `morph/morph-v3-fast`.               |
| `CLAUDE_CODE_PI_MORPH_TIMEOUT_MS` | Morph request timeout. Default 6000.                               |
| `CLAUDE_CODE_PI_MORPH_API_KEY`  | Optional OpenRouter key override (else `OPENROUTER_API_KEY` / auth). |

Before starting `claude`, the bridge removes Anthropic API key, auth token, base URL, custom header and Bedrock/Vertex/Foundry variables from the environment, so every turn uses the Claude Code login.

`claude-code-models-env.ts` still pins `claude-fable-5-1` before this provider loads.

## Commands

`/claude-code-pi status|models|test|help`

## Install

Repo copy is this folder. After `make install`, drop `npm:claude-code-pi` from `settings.json` so only one `claude-code-cli` provider registers. Then `/reload`.
