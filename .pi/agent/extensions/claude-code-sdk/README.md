# claude-code-sdk

Pi provider `claude-code-sdk`. Each model turn runs `@anthropic-ai/claude-agent-sdk` `query()` against the local `claude` binary, with Pi tools exposed natively through an in-process MCP server.

## Bridge contract

- `tools: []` — Claude Code built-ins off; no Claude-side execution of anything except the bridge.
- Pi tools are registered on an in-process `"pi"` SDK MCP server (`createSdkMcpServer`), so the model sees and emits native `tool_use` blocks named `mcp__pi__<tool>`.
- MCP handlers never execute. They hand each call to the active `BridgeTurn` and await an outcome.
- The model's `tool_use` blocks are emitted as real Pi toolCall parts (native ids) and executed model-issued through Pi's full pipeline: validation, hooks, damage control, permission checks, transcript records, TUI rows.
- One SDK drain per user message; provider cycles attach to it. Each cycle streams thinking/text live and ends with `toolUse` (new tool calls) or `stop` (the result). Cycle pre-work feeds Pi's toolResult messages to the pending MCP handlers, so the CLI continues natively.
- `systemPrompt: { type: "custom", prompt, snapshot: false }` — bridge identity, Pi-name → `mcp__pi__*` mapping, commit trailer rules, and the full Pi system prompt (SYSTEM.md pointer to `self`, addendum, project, skills, cwd).
- `permissionMode: "bypassPermissions"` with MCP present is safe: the only CLI-side tools are the bridge handlers, which route into Pi's own gate.
- Capability turns (no tools) keep the plain one-shot flow; their registry key includes the capability name so nested capability calls during a main turn never collide.

## Layout

```text
claude-code-sdk/
  index.ts         register provider + bridge tool + /claude-code-sdk
  models.ts        aliases (sonnet, opus, haiku, fable)
  sessions.ts      Pi id ↔ Claude UUID
  queryOptions.ts  SDK Options builder (MCP, permissions, thinking)
  stream.ts        query() drain per user message; cycles attach and stream live
  rendezvous.ts    ActiveBridgeTurn: pump, tool_use parse, handler/outcome rendezvous
  mcpBridge.ts     in-process "pi" MCP server from Pi tools
  zodSchema.ts     JSON Schema (TypeBox) → zod raw shape for MCP tool inputs
  prompt.ts        bridge prompt + transcript serialization
  cli.ts           binary, env strip, effort map, status
  README.md
```

## Env

See `Env` in `README` history: `CLAUDE_CODE_PI_BIN` (binary path), `CLAUDE_CODE_SDK_IDLE_MS` (idle watchdog, default 300000, reset on every SDK message and on bridge activity), `CLAUDE_CODE_PI_TIMEOUT_MS` unused legacy.

## Commands

- `/claude-code-sdk status|models|help` — provider status.
- `/claude-sdk-refresh` — drop the mirrored Claude session; next turn seeds a fresh one (also clears bridge turn state).

## Models

`claude-code-sdk/sonnet|opus|haiku` (aliases resolved by the local CLI).
