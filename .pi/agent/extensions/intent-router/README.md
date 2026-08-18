# intent-router

Per-message model routing. A classifier labels the prompt; this extension switches the session model for that turn, then restores the previous model when the agent settles.

Copy `sample.config.json` to `config.json`.

- Fresh chat starts **off** unless `config.enabled` is `true` (then startup/`/reload` auto-probes).
- Turn on with `/intent` or `/intent on` (probes classifier first).
- Fail-open: a classify or switch error keeps the current model.

## Decision tree

```text
Intent Router Decision Tree
===========================

1. Enabled?
   ├── No → Skip (keep current model)
   └── Yes → Continue

2. Prompt empty or starts with '/'?
   ├── Yes → Skip (slash commands)
   └── No → Continue

3. Confirmation (yes/ok/go...) + prior assistant?
   ├── Yes → Stay (needsCurrentThread)
   └── No → Classify

4. Classify result
   ├─ Error/fail-open → Stay
   ├─ needsCurrentThread → Stay
   ├─ includesEnglish → Stay
   └─ Route key found?
      ├─ No → Stay (fail-open)
      └─ Yes → Switch model → restore after agent_settled
```

`key` comes from the classifier:

```text
classify
├─ question ............................ question
└─ instruction
   ├─ code ............................. instruction.code.basic | .adv
   ├─ ops .............................. instruction.ops.basic | .adv
   └─ terminal ......................... instruction.terminal.readonly | .basic | .adv
```

## Commands

`/intent` toggles. Subcommands: `on`, `off`, `probe`, `last`, `routes`.
