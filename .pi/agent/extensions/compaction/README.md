# compaction

Fork of pi's internal compaction. The summary logic lives here, in this repo, where we can change it.

Pi still owns three things: the token threshold that triggers compaction, the cut point that picks which messages to summarize, and overflow recovery. Everything that turns old messages into the Goal / Progress / Decisions summary runs in this folder.

## Files

| File         | Role                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------- |
| `index.ts`   | `session_before_compact` hook, resolves model auth, calls `compactLocal`                                      |
| `compact.ts` | Summary generation, split-turn merge, file tags. Forked from pi `dist/core/compaction/compaction.js`          |
| `prompts.ts` | The Goal / Progress / Decisions prompt, the update prompt, the split-turn prompt                              |
| `utils.ts`   | File list extraction, conversation serialization, tool-result truncation. Forked from pi `dist/core/compaction/utils.js` |
| `prune.ts`   | Jev-based pruning of irrelevant tool pairs before summarization                                               |
| `jev.ts`     | Minimal TypeSafe System One client (Noul questions only)                                                      |

## What changed from stock pi

### 1. Jev prunes noise before summarization

Before the summary LLM sees anything, each toolCall + toolResult pair gets judged by TypeSafe Jev: keep this in the summary, yes or no. The call returns a probability. Code drops pairs below a dynamic threshold.

The threshold comes from the batch itself, not a constant:

- Take all probabilities from one compact as one sample.
- n < 4: threshold 0.10. Almost nothing drops.
- Otherwise: `threshold = mean - 1.0 * sigma`, clamped to [0.10, 0.70]. A batch where everything scores 0.85 hits the 0.70 cap and drops nothing; a batch stuck at 0.17 trims only the tail below the mean.
- Top `ceil(n/4)` pairs always survive, even below threshold.

A batch where everything scores 0.85 drops nothing. A batch full of 0.2 noise still keeps its best quarter.

While a compact runs, the footer status bar shows `compaction: pruning tool pairs (Jev)…` then `compaction: summarizing…`, then clears. No output is printed to the terminal.

Every compact also appends one calibration line to `prune-stats.log` next to this file:

```
[compaction-prune] n=32 mu=0.166 sigma=0.035 threshold=0.131 p=[...] dropped=8
```

### 2. Hard keep-list in code

Jev never sees these, so Jev can never drop them:

- `write` and `edit` calls
- Tool results with `isError`
- Result heads matching `FAILED`, `error:`, `assert`, `Traceback`, `Exception`
- Tool calls in the last user turn of the summarized span

This list exists because Jev ranked a failing test at 0.16, same as a `git status` no-op. Threshold math does not fix mis-ranking. The sieve does.

### 3. Fail-open everywhere

No TypeSafe key, HTTP error, 401, 422, timeout, abort, or missing answer: the drop set stays empty and the summary LLM sees the full conversation, same as stock pi. Jev calls are capped at 2 per compact, 16 questions each, 10 second timeout. Leftover pairs stay unjudged.

## Cost and failure notes

- Pruning adds one or two small Jev calls (about 300 input tokens each) before each summary. The 10s timeout plus the 2-call cap bound the delay during overflow compaction.
- Returning a compaction from this hook sets `fromHook: true` on the saved entry. Stock pi then skips inheriting `readFiles` / `modifiedFiles` from that entry on the next compaction. This extension still computes file tags from the messages, so this only affects stock behavior if you disable this extension later mid-session.
- A summary that hits the length cap throws and never persists. Same as stock.

## Tuning

| Constant       | Location   | Default  | Effect                                                                              |
| -------------- | ---------- | -------- | ----------------------------------------------------------------------------------- |
| `K_SIGMA`      | `prune.ts` | 1.0      | Aggression. Higher drops more.                                                      |
| `THRESH_FLOOR` | `prune.ts` | 0.10     | Minimum possible threshold. Keep low: a high floor mass-drops tight low clusters.   |
| `THRESH_CAP`   | `prune.ts` | 0.70     | Nothing at or above this ever drops.                                                |
| `SIGMA_MIN`    | `prune.ts` | removed  | Was: cluster gate. Cut it; the 0.70 cap covers high clusters and the gate mass-dropped low ones. |
| `MAX_CALLS`    | `prune.ts` | 2        | Jev calls per compact.                                                              |
| `EVIDENCE_RE`  | `prune.ts` | see file | Result patterns that force-keep.                                                    |

Change a prompt in `prompts.ts` and the probability distribution shifts. Re-check prune-stats.log after any prompt edit; the threshold constants were tuned against the current prompts.

## Auth

`jev.ts` reads `TYPESAFE_API_KEY` first, then `~/.pi/agent/skills/typesafe-ai/typesafe-auth.json`.
