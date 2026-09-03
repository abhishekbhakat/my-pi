---
name: plan
description: >-
  Use when user say "create plan". Coach-gated step by step plan and checklist
  execution. Triggers: "create plan", plan skill, step by step plan,
  checklist, work through list, complex multi-step task. Always gate plan,
  checklist, each item, pivot, and completion through reasoning_coach.
keywords: [create plan, plan, checklist, steps, coach-gated, pivot, verify complete]
---

# Plan

Coach decides plan shape. Agent executes checklist. No shortcut.

## Hard rules

- Every plan, checklist, item result, pivot, completion verdict pass through `reasoning_coach`.
- Plan edit allowed only when coach says change or pivot needed. No self-edit.
- Item marked complete only after post-task coach check says complete.
- One item at a time. Finish current item before next.
- Keep checklist visible. Restate state each turn: done count, current item, next action.

## Protocol

### 1. Coach builds plan

Call `reasoning_coach`. Task packet:

```text
Goal: <user goal verbatim>
Context: <paths, constraints, known state>
Ask: build step by step plan. Order steps. Name dependencies. Flag ambiguity.
```

Output plan numbered. Ask user to confirm goal/scope before checklist when ambiguity remains.

### 2. Coach builds checklist

Second `reasoning_coach` call. Task packet:

```text
Approved plan: <plan from step 1>
Ask: turn plan into step by step checklist. One bounded action per item.
Each item verifiable. Fewest items that work. Cap 5 per group; split do-now vs later when longer.
```

Freeze checklist. Number items `1..N`.

### 3. Expand checklist with coach gates

Rewrite each item into fixed loop:

```text
[N.1] Pre-coach: reason with coach on how to do item N.
[N.2] Do item N.
[N.3] Post-coach: reason with coach on whether item N complete.
[N.4] Mark N complete only on coach pass. Else fix and re-check.
```

Never collapse gate steps. Never batch pre/post checks across items.

### 4. Execute loop per item

For each item N in order:

1. Pre-coach call. Packet: item text, full checklist, files touched so far, exact question: approach plus pitfalls for this item only.
2. Do task. Read before edit. Minimal change. Narrowest check after change.
3. Post-coach call. Packet: what changed (paths + lines), check output, exact question: item complete or not, what remains.
4. Coach says complete: mark `[x]`. Coach says incomplete: apply fix, rerun check, re-ask coach. No advance until pass.
5. State line: `Item N/M done: <name>. Next: <N+1 name>.`

### 5. Final completion check

After all `[x]`, call `reasoning_coach`. Packet:

```text
Plan: <original plan>
Checklist: <all items with [x]>
Changes: <paths, checks run>
Ask: plan complete against original goal? Name gaps, regressions, leftover work.
```

Coach says incomplete: add coach-named items only, run loop again. Coach says complete: report done plus verification status.

### 6. Pivot rule

Mid-run coach says plan wrong, step missing, order wrong, pivot needed:

1. Ask coach for revised plan/checklist delta.
2. Apply coach delta only. Note pivot: item number, reason, what changed.
3. Resume loop at correct item. Never rewrite unchecked items on own judgment.

User-requested scope change also needs coach pass before checklist edit.

## Output shape

```text
Plan:
1. ...
2. ...

Checklist:
- [ ] 1. Pre-coach on <item> / Do / Post-coach / Mark complete
- [ ] 2. ...

Progress: Item 2/4 done: <name>. Next: <name>. Run <narrowest check>?
```

## Ban list

- No checklist from memory alone. Coach builds it.
- No silent plan edit. Coach source or no edit.
- No `[x]` without post-coach pass.
- No parallel items. No skip.
- No tool-call narration. Fire `reasoning_coach`, report verdict.
