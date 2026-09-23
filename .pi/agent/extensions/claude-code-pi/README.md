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
  prompt.ts     transcript dump, delta dump, <pi_tool_call> parse
  stream.ts     streamSimple: pick seed vs resume vs stateless, spawn
  README.md
```

## Session map

1. `session_start` stores the active Pi session id.
2. First turn for that id: `--session-id <uuid>` and full prompt. On exit 0, record `initialized` and a hash of the messages sent.
3. Later turns whose message prefix matches that hash: `--resume <uuid>` and only new messages.
4. Helper tools and `/undo` that do not match the prefix: `--no-session-persistence` and a full dump. The map file is left alone.

Claude Code tools stay off (`--tools ""`). When Pi offers tools, the bridge teaches `<pi_tool_call>` blocks and Pi executes them. Tool-free callers (capability helpers, cache warmup) get a plain-text bridge and never parse `<pi_tool_call>` into `toolUse`.

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
