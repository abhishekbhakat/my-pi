---
name: dynamo-submit
description: "Submit Terminal-Bench 2 (TB2) / Project Dynamo task: understand pass@k evaluation and timeouts, pass pre-submit gates, push branch, open PR, and finish on platform. Use when task is built and ready to submit, when pass@2/pass@5 results need interpret, or when PR pipeline (validity check, Automated Review, pass@5) fail or stall."
---

Submit built TB2 task. Full page text: `reference/13-submit-pass-at.md`,
`13-submit-checklist.md`, `13-submit-push.md`, `13-submit-platform.md`.

## The pass@ contract

1. **Bar: pass@5 ≤ 2/5.** Oracle prove task is solvable; model must fail
   at least 3 of 5 attempts to prove it is hard. 0/5 with VALID failures (model
   finish and get answer wrong) is strongest result.
2. **Timeout hard cap: 3600 seconds.** Set `[agent].timeout_sec` ≤ 3600. Pass@2 and
   Pass@5 both run at your value, and number must match closing line of
   instruction.md. Timeout must let model FINISH; task that cannot finish
   in 3600s is broken, not hard. Challenge correctness, never speed.
3. **Reference measurement.** Recorded pass@5 must come from model `GPT-5.4` (max
   completion tokens 128,000, reasoning xhigh) with agent `Terminus-2`, 5 trials, run
   through Harbor. Cheaper models (Sonnet, Haiku) are fine for local pre-filtering.
4. **Pass@2 is limited to 6 runs per day** per fellow per task. Get task green
   with oracle local before spend run.

## The evaluation pipeline

Each layer gate next:

1. Proposal (automated gate)
2. Pull request
3. Validity check (automated LLM check on PR)
4. Pass@2 at your timeout. If EITHER trial time out, task is rejected.
5. Automated Review (gap-rubric LLM review). Fix every Blocking Issue and push before
   it pass. Ready = green checks plus PASS verdict.
6. Pass@5 at your timeout. Run ONLY after Pass@2 produce valid run and
   Automated Review pass. If it fail gate, fix and push; pipeline re-run.

Reading results: github-actions bot post **Pre-check (pass@2)** comment. Open
it, expand "Pass@ Analysis — Model A", click "View logs & artifacts", then on run
Summary page scroll to artifacts list. Download `pass2-output` for trial logs;
`qc-eval-results` and `qc-exec-results` hold QC output. Artifacts expire, so download
soon or re-run.

## Pre-submit checklist (all four must pass; do NOT submit otherwise)

1. `harbor run -p . --agent oracle`: reward 1.0; `harbor run -p . --agent nop`: < 1.0.
2. `[agent].timeout_sec` match "You have N seconds…" line in instruction.md and
   is justified by oracle actual runtime with headroom, not padded.
3. Pass@2 cleared at ≤ 3600s without timeouts.
4. Pass@5 in 0–2/5 band, recorded in PR. (3–5/5 mean too easy. 0/5 from
   timeouts or ambiguity is broken. Neither may be submitted.)

## Push and open PR

```bash
git add -A && git commit -m "Task submission"
git push -u origin submission
gh pr create --repo handshake-project-dynamo/<your-task-repo> --fill
# iterate: edit, git add -A && git commit -m "Address review feedback", git push
```

Use PR description template from dynamo-create-task skill. Checks re-run on
every push and update their PR comments in place.

## Platform steps (after PR checks go green)

1. Confirm PR is green on GitHub first.
2. Walk platform checklist item by item. Add reviewer notes cover anything
   subtle or non-obvious.
3. Screenshot pass@ results comment on PR, attach it on platform, and
   enter pass@ score.
4. Read pass@ Job Analysis before submit. Failed run alone is not enough;
   use analysis to improve task first.

## Reading pass@5 results

| Result | Meaning | Outcome |
|--------|---------|---------|
| 0/5 valid failures (oracle passes, no timeouts/errors) | Fully stumped | Accepted |
| 0/5 invalid failures (timeout, agent/verifier error, ambiguous prompt) | Broken, not hard | Rejected: fix the cause |
| 1–2/5 | Solvable and hard, failures valid | Accepted |
| 3–5/5 | Too easy | Rejected: raise difficulty with edge cases, multi-step reasoning, or a stronger verifier. NEVER lower the timeout or add busywork |

Fix invalid-failure causes. Timeout: move difficulty into reasoning, trim
expensive steps, raise timeout only if justified at ≤ 3600. Ambiguous prompt:
tighten to one reasonable interpretation. Brittle verifier: make it test real
requirement, accept any sound correct answer. Not solvable: run oracle in
clean container until it reach reward 1.0.

Source: https://project-dynamo.learn.joinhandshake.com/submit/pass-at (captured 2026-07-08).
