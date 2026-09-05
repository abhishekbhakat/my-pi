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
- Checklist lives in `.agents/PLAN-<slug>.md`. State line each turn derived from file: done count, current item, next action. Read file before each state line.
- No file edit without coach verdict.
- No silent overwrite of active plan file. Ask resume, abandon, or start new.

## Plan file

One file per plan: `.agents/PLAN-<slug>.md` at project root. Slug: 2-4 kebab words from goal, chosen at step 2 write time. Chat holds only one-line status.

Format:

```markdown
---
goal: <user goal verbatim>
created: <date>
status: active | done | abandoned
current: <item number>
session: <PI_SESSION_ID or unknown>
---

## Plan
1. ...

## Checklist
- [ ] 1. <item>
- [x] 2. <item>

## Pivots
- Item N: <reason> -> <delta>
```

- Agent writes file only after coach verdict: build, mark complete, pivot, completion.
- Gate steps N.1-N.4 never written to file. File holds item-level checklist only.
- Coach packets pass `paths: [<actual plan filename>]` instead of embedding full plan text.
- At skill start: glob `.agents/PLAN-*.md`. Read frontmatter before any delete. Delete files with `status: done` or `abandoned`. For each `status: active`, ask user: resume, abandon, or start new. Same-slug active file exists: never silent overwrite, never auto-append timestamp.

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

Freeze checklist. Number items `1..N`. Pick slug from goal. Write `PLAN-<slug>.md` with `status: active`, `current: 1`. File is frozen source of truth.

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
4. Coach says complete: mark `[x]` in file, bump `current` to next item. Coach says incomplete: apply fix, rerun check, re-ask coach. No advance until pass.
5. State line from file: `Item N/M done: <name>. Next: <N+1 name>.`

### 5. Final completion check

After all `[x]`, call `reasoning_coach`. Packet:

```text
Plan: <original plan>
Checklist: <all items with [x]>
Changes: <paths, checks run>
Ask: plan complete against original goal? Name gaps, regressions, leftover work.
```

Coach says incomplete: add coach-named items only, run loop again. Coach says complete: set `status: done` in file, report done plus verification status. File deleted at next skill start.

### 6. Pivot rule

Mid-run coach says plan wrong, step missing, order wrong, pivot needed:

1. Ask coach for revised plan/checklist delta.
2. Apply coach delta to file only. Append to `## Pivots`: item number, reason, what changed.
3. Resume loop at correct item. Never rewrite unchecked items on own judgment.

User-requested scope change also needs coach pass before checklist edit.

## Output shape

```text
Plan: .agents/PLAN-fix-auth-timeout.md
Checklist: 4 items, 1 done
Progress: Item 2/4 done: <name>. Next: <name>. Run <narrowest check>?
```

## Ban list

- No checklist from memory alone. Coach builds it.
- No silent plan edit. Coach source or no edit. File edit counts as plan edit.
- No `[x]` without post-coach pass.
- No parallel items. No skip.
- No tool-call narration. Fire `reasoning_coach`, report verdict.
