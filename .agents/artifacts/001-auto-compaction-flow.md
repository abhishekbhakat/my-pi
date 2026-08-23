---
number: 1
name: Auto-compaction flow
slug: auto-compaction-flow
createdAt: 2026-08-22T21:50:17.645Z
sessionId: 01a02b70-70a2-79a5-ac08-63e985f89b9a
sessionFile: /Users/abhishekbhakat/.pi/agent/sessions/--Users-abhishekbhakat-CODES-my-pi--/2026-08-22T21-46-24-290Z_01a02b70-70a2-79a5-ac08-63e985f89b9a.jsonl
sourceEntryId: 4fe16881
---

## Auto-compaction flow

Key files:
- `dist/core/agent-session.js` → `_checkCompaction`, `_runAutoCompaction`, `compact`
- `dist/core/compaction/compaction.js` → `shouldCompact`, `prepareCompaction`, `findCutPoint`, `compact`
- `dist/core/session-manager.js` → `appendCompaction`, `buildSessionContext`

Settings default: `enabled: true`, `reserveTokens: 16384`, `keepRecentTokens: 20000`.

```mermaid
flowchart TD
  subgraph entry [Entry points]
    A1["_handlePostAgentRun<br/>after agent_end"]
    A2["prompt()<br/>before new user turn<br/>skipAbortedCheck=false"]
    A3["manual /compact<br/>or ctx.compact()"]
    A1 --> CHK
    A2 --> CHK
    A3 --> MAN
  end

  subgraph guards [Guards in _checkCompaction]
    CHK["_checkCompaction(assistantMsg)"]
    G1{"settings.enabled?"}
    G2{"aborted and skipAbortedCheck?"}
    G3{"assistant older than<br/>latest CompactionEntry?"}
    G4{"same model as<br/>current session model?"}

    CHK --> G1
    G1 -->|no| NO["return false<br/>no compact"]
    G1 -->|yes| G2
    G2 -->|yes| NO
    G2 -->|no| G3
    G3 -->|yes| NO
    G3 -->|no| DECIDE
  end

  subgraph decide [Two auto reasons]
    DECIDE{overflow or<br/>recoverable length?}
    OV["Case 1: overflow"]
    TH["Case 2: threshold"]

    DECIDE -->|sameModel and<br/>isContextOverflow or<br/>isRecoverableLength| OV
    DECIDE -->|else| TH

    OV1{"stopReason === stop?<br/>success over window"}
    OV2{"_overflowRecoveryAttempted?"}
    OV_DROP["drop last assistant<br/>from agent.state.messages"]
    OV_RETRY["willRetry = true<br/>flag recovery attempted"]
    OV_ONCE["emit fail once<br/>return false"]
    OV_NR["willRetry = false<br/>compact only"]

    OV --> OV1
    OV1 -->|yes success over window| OV_NR
    OV1 -->|no error or length| OV2
    OV2 -->|already tried| OV_ONCE
    OV2 -->|first time| OV_DROP --> OV_RETRY

    TH1["contextTokens from<br/>assistant.usage.totalTokens<br/>or estimateContextTokens"]
    TH2{"usage source<br/>pre-compaction?"}
    TH3{"shouldCompact?<br/>tokens > window - reserveTokens"}

    TH --> TH1 --> TH2
    TH2 -->|yes| NO
    TH2 -->|no| TH3
    TH3 -->|no| NO
    TH3 -->|yes| RUN_T[" _runAutoCompaction<br/>reason=threshold<br/>willRetry=false"]

    OV_NR --> RUN_O[" _runAutoCompaction<br/>reason=overflow<br/>willRetry=false"]
    OV_RETRY --> RUN_O2[" _runAutoCompaction<br/>reason=overflow<br/>willRetry=true"]
  end

  subgraph run [ _runAutoCompaction / manual compact ]
    MAN["abort agent<br/>emit compaction_start manual"]
    RUN_T --> PREP
    RUN_O --> PREP
    RUN_O2 --> PREP
    MAN --> PREP

    PREP["prepareCompaction(branch path, settings)"]
    PREP0{"last entry already<br/>compaction? or nothing<br/>to summarize?"}
    PREP -->|undefined| FAIL_PREP["auto: return false<br/>manual: throw"]
    PREP --> PREP0
    PREP0 -->|bad| FAIL_PREP
    PREP0 -->|ok| EXT

    EXT{"session_before_compact<br/>handlers?"}
    EXT -->|cancel| CANCEL["emit compaction_end aborted"]
    EXT -->|custom compaction| USE_EXT["use extension summary"]
    EXT -->|default| COMPACT_FN["compact(preparation, model, ...)"]

    COMPACT_FN --> SPLIT{"isSplitTurn?"}
    SPLIT -->|yes| TWO["1. generateSummary history<br/>2. generateTurnPrefixSummary<br/>3. merge texts"]
    SPLIT -->|no| ONE["generateSummaryWithUsage<br/>messagesToSummarize<br/>+ previousSummary"]
    TWO --> FILES
    ONE --> FILES
    FILES["append read/modified file lists"]
    USE_EXT --> SAVE
    FILES --> SAVE

    SAVE["sessionManager.appendCompaction<br/>summary, firstKeptEntryId,<br/>tokensBefore, details, usage"]
    SAVE --> REBUILD["buildSessionContext()<br/>agent.state.messages = summary + kept"]
    REBUILD --> EV_END["emit session_compact<br/>emit compaction_end"]
  end

  subgraph after [After auto-compact]
    EV_END --> RETRYQ{"willRetry?"}
    RETRYQ -->|yes| STRIP["if last msg assistant<br/>error/length: strip again"]
    STRIP --> CONT["return true<br/>agent continues turn"]
    RETRYQ -->|no| Q{"queued follow-up<br/>or steer messages?"}
    Q -->|yes| CONT2["return true<br/>deliver queues"]
    Q -->|no| DONE["return false<br/>user continues"]
  end

  subgraph prep_detail [prepareCompaction internals]
    P1["find latest prior CompactionEntry"]
    P2["boundaryStart =<br/>prev.firstKeptEntryId<br/>else session start"]
    P3["findCutPoint walk back<br/>until keepRecentTokens ~20k"]
    P4["valid cut: user / assistant / bash / custom<br/>never toolResult"]
    P5{"cut mid-turn?"}
    P6["messagesToSummarize =<br/>boundaryStart..historyEnd"]
    P7["turnPrefixMessages =<br/>turnStart..firstKept"]
    P8["extractFileOperations<br/>from msgs + prev details"]

    P1 --> P2 --> P3 --> P4 --> P5
    P5 -->|yes isSplitTurn| P7
    P5 -->|no| P6
    P7 --> P6 --> P8
  end

  subgraph llm_view [What LLM sees next turn]
    V1["system prompt"]
    V2["compaction summary message"]
    V3["entries from firstKeptEntryId<br/>to leaf on current branch"]
    V1 --> V2 --> V3
    NOTE["JSONL keeps full history.<br/>CompactionEntry only changes<br/>what buildSessionContext sends."]
  end
```

## Trigger math

```text
threshold:  contextTokens > contextWindow - reserveTokens
default:    contextTokens > contextWindow - 16384

keepRecent: walk newest→oldest until ~20000 tokens kept
```

## Two auto reasons

| reason | when | willRetry |
| --- | --- | --- |
| `overflow` | context overflow error, or recoverable `length` stop, same model | `true` only if stop was not successful `stop` |
| `threshold` | usage / estimate over window − reserve | always `false` |

## Common failure / no-op paths

1. `compaction.enabled = false`
2. last assistant aborted (post-run path skips)
3. assistant older than latest compaction (stale usage guard)
4. overflow from different model than current
5. overflow recovery already tried once this cycle
6. no usage data and no estimable prior usage
7. usage source is pre-compaction message
8. `prepareCompaction` returns undefined (already compacted / nothing to cut / session too small)
9. extension cancels `session_before_compact`
10. summarization LLM error (emit fail, keep old context)

## Mental model

```text
JSONL branch path (immutable append)
  ...old msgs... | kept msgs... | CompactionEntry

LLM context rebuild:
  [system] + [summary from latest cmp] + [msgs from firstKeptEntryId → leaf]
```

Repeated compact re-summarizes from previous `firstKeptEntryId`, not from the compaction entry itself, so earlier kept msgs get folded into next summary.

---

If you want next step: dig why auto compact fail on your session. Paste footer context `%`, model `contextWindow`, and any `Auto-compaction failed` / `Context overflow recovery failed` line.
