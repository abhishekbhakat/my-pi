# claude-code-sdk

Pi provider `claude-code-sdk`. Each model turn runs `@anthropic-ai/claude-agent-sdk` `query()` against the local `claude` binary (T3 Code style).

## Layout

```text
claude-code-sdk/
  index.ts         register provider + /claude-code-sdk
  models.ts        aliases (sonnet, opus, haiku, fable)
  sessions.ts      Pi id ↔ Claude UUID
  queryOptions.ts  SDK Options builder
  stream.ts        query() → Pi stream events (live thinking)
  cli.ts           binary, env strip, effort map, status
  prompt.ts        bridge prompt + tool XML parse
  morphRepair.ts   OpenRouter Morph for broken tool XML
  claudeTools.ts   Anthropic function_calls XML
  blockCall.ts     legacy pi-tool-call fences
  README.md
```

## Env

| Variable                  | Role                                           |
| ------------------------- | ---------------------------------------------- |
| `CLAUDE_CODE_PI_BIN`      | Claude executable. Default `claude`.           |
| `CLAUDE_CODE_SDK_MODELS`  | Aliases. Falls back to `CLAUDE_CODE_PI_MODELS` |
| `CLAUDE_CODE_SDK_IDLE_MS` | Idle abort. Default 300000.                    |

## Commands

`/claude-code-sdk status|models|help`  
`/claude-sdk-refresh`
