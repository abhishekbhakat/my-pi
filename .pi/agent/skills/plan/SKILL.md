---
name: plan
description: >-
  Execute multi-step plans with tool-enforced checklist state. Triggers: "create
  plan", plan skill, step by step plan, checklist, work through list, complex
  multi-step task. reasoning_coach shapes the plan once and judges completion;
  the plan tool enforces execution (checks, one item at a time, escalation).
  Coach is event-driven, not per item.
keywords: [create plan, plan, checklist, steps, execution, escalation, verify complete]
---

# Plan

Coach shapes. Tool enforces. Agent executes.

## Roles

- `reasoning_coach`: plan build (once), completion verdict (once), escalation (only when a trigger fires).
- `plan` tool: checklist state in `.agents/PLAN-<slug>.json`. Enforces checks, one active item, stale evidence, regression sweep, amend log. The generated `.md` is a view, not state.
- Agent: execute items, run checks, escalate on triggers. Never self-certify an item.

## Start

1. `plan { action: "list" }`. Active plan exists: ask user resume, abandon, or new. Never overwrite.
2. No active plan: build one (below). `create` prunes done/abandoned plans automatically.

## Build (one coach call)

1. Gather context. Use `code_scout` when the code area is unfamiliar. Ask the user only questions that block the plan.
2. Call `reasoning_coach` with Packet A. It returns plan + checklist as structured items.
3. `plan { action: "create", goal, items, riskiestItem, risks }`. Every item needs a `check` (narrowest shell command, exit 0 = verified) or `judgment` (acceptance text) plus `files` and `assumptions`.

Packet A:

```text
Goal: <user goal verbatim>
Constraints: <repo rules, forbidden areas, scope limits>
Code map: <code_scout output or known paths>
Known unknowns: <what could not be determined>
Ask: return plan + checklist as structured items. Fewest items that work, cap 5 per group.
Per item: {action, files[], check: <shell cmd> | judgment: <acceptance text>,
           dependsOn[], assumptions[]}
Also: riskiestItem, top 3 risks, questions that block start.
```

User questions from Packet A get answered before item 1.

## Execute (per item, no coach)

For the current item in order:

1. `plan { action: "claim", item }`. Claim fails while dependencies or another item are open.
2. Do the work. Minimal change inside `files`. `code_scout` only if the location is unclear.
3. `plan { action: "check", item }`. Cmd items: the tool runs the check itself. Judgment items: run the judge (`boolean_guy` Noul over the acceptance text), then `complete` with `judgmentVerdict` and `judgmentSource` (who judged, what returned). No judge available: ESCALATE, never self-pass.
4. `plan { action: "complete", item }`. Fails on stale or missing evidence; re-check and retry. On ESCALATE output, stop and run the escalation packet.
5. State line for the user from the tool output: `Item N/M done: <name>. Next: <name>.`

One item at a time. The tool blocks skips and parallel work; do not route around it.

## Escalate (event-driven coach call)

Tool output `ESCALATE [trigger]`, or any trigger below, means call `reasoning_coach` with Packet C before continuing. Not a trigger: a check failing once and fixed next try, lint or format fixes, wording changes.

Triggers:

1. `two_failed_fixes` — same item's check failed twice.
2. `regression` — a finished item's check goes red (tool sweep).
3. `scope_drift` — edits outside the item's declared files (tool sweep).
4. `structural_amend` / `drop` — second structural amend in a run, or any drop.
5. `uncheckable` — judgment item with no judge, or judge returns fail twice.
6. Assumption broken — a Packet A assumption is false, or `code_scout` finds nothing where the plan said.
7. Stuck — item exceeds roughly 25 tool calls.
8. User changes scope mid-run.

Packet C:

```text
Goal + plan state: <plan status output>
Trigger: <which one fired>
Evidence: <failing check output, attempts tried, falsified assumption>
Ask: continue | adjust item N | amend plan. Return delta as tool-format items.
```

Apply the delta with `plan { action: "amend", ... }` (reason required, append-only log), then resume the loop. Rewording an item is allowed without coach; anything structural escalates by tool.

## Complete (one coach call)

After every item is done or dropped:

```text
Goal: <verbatim>
Checklist: <plan status output: items + recorded check evidence>
Amends: <amend log>
Changes: <git diff --stat, or paths>
Ask: goal met? gaps, regressions, scope creep, leftover work. Return new items or "done".
```

Coach returns new items: `amend add` each one and keep looping. Coach says done: report done with verification status. The plan file is pruned at the next `create`.

## Output shape

```text
Plan: .agents/PLAN-fix-auth-timeout.json
Checklist: 4 items, 1 done
Progress: Item 2/4 done: <name>. Next: <name>. Run <narrowest check>?
```

## Ban list

- No checklist from memory. Packet A builds it.
- No `[x]` by assertion. Only `complete` with fresh evidence.
- No per-item coach calls on clean runs. Coach at build, completion, and escalation only.
- No silent plan edits. `amend` with reason; structural changes escalate.
- No tool-call narration. Fire the tool, report state.
