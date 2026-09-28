# mistral-vibe-cli

Pi provider `mistral-vibe-cli`. Each model turn runs local `vibe -p`. No Mistral SDK and no HTTP fallback.

## Layout

```text
mistral-vibe-cli/
  index.ts    register provider, /mistral-vibe-cli, session_start status check
  models.ts   model registry (default + MISTRAL_VIBE_CLI_MODELS aliases)
  cli.ts      vibe binary, argv, env hygiene, timeout, status check
  prompt.ts   transcript dump, <pi_tool_call> parse, JSON output parse
  stream.ts   streamVibeCli: spawn vibe -p, parse, emit Pi events
  README.md
```

## How a turn runs

1. Pi calls `streamSimple` with the normalized transcript.
2. The bridge rebuilds the conversation: bridge instructions, Pi system prompt, available Pi tools, full transcript.
3. `vibe -p --legacy-harness --enabled-tools __none__ --output json --max-turns 1` runs with the prompt on stdin. Vibe 2.25.8's unified harness still offers native tools with `--enabled-tools __none__`; the legacy harness respects the empty allowlist. If Vibe removes `--legacy-harness`, the CLI exits rather than running with native tools.
4. Vibe's own tools are disabled, so Vibe never executes anything. When Pi offers tools, the bridge teaches `<pi_tool_call>` blocks and Pi executes them. Tool-free callers (capability helpers, cache warmup) get a plain-text bridge and never parse `<pi_tool_call>` into `toolUse`. Block parsing is lenient: a trailing block missing its `</pi_tool_call>` close tag is salvaged up to the end of the message, and a complete JSON value followed by junk (stray backticks) is parsed by cutting at the last closing brace. If a block still does not parse (triple quotes, raw newlines in string values), the bridge re-runs `vibe -p` once with the broken output and the parse error, and adopts the corrected call; if the retry also fails, the block lands as plain text as before.
5. The JSON message array is parsed; assistant text and structured thinking become the Pi assistant message. In `auto` mode, the bridge also recognizes Python-repr thinking chunks at the start of assistant text (for example `{'type': 'thinking', 'thinking': [{'type': 'text', 'text': '...'}]}`), joins their text fragments, and sends them as Pi thinking. It leaves unmatched text alone. When Vibe returns only reasoning, the bridge asks for a final answer once and includes up to 4,000 characters of recent reasoning. If Vibe still returns no answer or tool call, Pi reports the incomplete response. Try a shorter prompt or another Vibe model.

Stateless by design: every turn resends the full transcript. `vibe -p` has no session-resume contract for programmatic mode, so there is no session map to corrupt. Each run writes a Vibe session log under `~/.vibe/logs/session/` — that is Vibe's own behavior.

## Models

- `mistral-vibe-cli/default` runs Vibe with its own configured `active_model`.
- `mistral-vibe-cli/glm-5.3` selects Vibe's configured `glm-5-3` alias (zai-glm-5-3) through `VIBE_ACTIVE_MODEL`. Its 262144 context window comes from the `modelOverrides` entry in `.pi/agent/models.json` — models.json overrides are the topmost layer pi applies over extension-registered models.
- Every other registered id is a Vibe model alias from `~/.vibe/config.toml`, pinned per turn through `VIBE_ACTIVE_MODEL`. An unknown alias silently falls back to Vibe's `active_model`.
- Override the registry with `MISTRAL_VIBE_CLI_MODELS="default,glm-5.3"` (comma-separated).

## Environment

| Variable | Effect |
| -------- | ------ |
| `MISTRAL_VIBE_CLI_BIN` | Override the vibe executable (default `vibe`) |
| `MISTRAL_VIBE_CLI_MODELS` | Comma-separated Vibe model aliases to register |
| `MISTRAL_VIBE_CLI_TIMEOUT_MS` | Per-turn timeout (default 300000) |
| `MISTRAL_VIBE_CLI_REPR_THINKING` | Parse Python-repr thinking at the start of assistant text (`auto`, default); set `off` to leave it as text |
| `MISTRAL_VIBE_CLI_CONTEXT_WINDOW` | Context window for all registered models (default 262144) |

The child env strips inherited `VIBE_ACTIVE_MODEL` and `MISTRAL_API_KEY`, then sets `VIBE_ACTIVE_MODEL` only for non-`default` models. Pi's `glm-5.3` ID maps to Vibe's `glm-5-3` alias. Vibe keeps its own auth in `~/.vibe/.env` and its own model config in `~/.vibe/config.toml`; inherited values would silently retarget it.

## Limits

- No images: `vibe -p` has no image input path, so the provider registers text-only models.
- No thinking control: `vibe -p` exposes no thinking flag; the model's Vibe config decides the level. Models register with `reasoning: false`, so Pi offers no thinking selector. Thinking still displays: Vibe emits it as a `type: "reasoning"` entry, and the bridge maps it to a Pi thinking block.
- No token accounting: `--output json` carries no usage, so usage is estimated from prompt/response length.
- Vibe runs in Pi's cwd as an untrusted folder in `-p` mode: project-local `.vibe/` config is never loaded, keeping the bridge deterministic.

## Commands

`/mistral-vibe-cli [status|models|help]`

Quick test:

```bash
pi -p --provider mistral-vibe-cli --model default "Reply with exactly OK"
```
