---
name: dynamo-submit
description: "Submit a Terminal-Bench 2 (TB2) / Project Dynamo task: understand pass@k evaluation and timeouts, pass the pre-submit gates, push the branch, open the PR, and finish on the platform. Use when a task is built and ready to submit, when pass@2/pass@5 results need interpreting, or when the PR pipeline (validity check, Automated Review, pass@5) fails or stalls."
---

Submit a built TB2 task. Full page text: `reference/13-submit-pass-at.md`,
`13-submit-checklist.md`, `13-submit-push.md`, `13-submit-platform.md`.

## The pass@ contract

1. **Bar: pass@5 ≤ 2/5.** The oracle proves the task is solvable; the model must fail
   at least 3 of 5 attempts to prove it is hard. A 0/5 with VALID failures (the model
   finishes and gets the answer wrong) is the strongest result.
2. **Timeout hard cap: 3600 seconds.** Set `[agent].timeout_sec` ≤ 3600. Pass@2 and
   Pass@5 both run at your value, and the number must match the closing line of
   instruction.md. The timeout must let the model FINISH; a task that cannot finish
   in 3600s is broken, not hard. Challenge correctness, never speed.
3. **Reference measurement.** The recorded pass@5 must come from model `GPT-5.4` (max
   completion tokens 128,000, reasoning xhigh) with agent `Terminus-2`, 5 trials, run
   through Harbor. Cheaper models (Sonnet, Haiku) are fine for local pre-filtering.
4. **Pass@2 is limited to 6 runs per day** per fellow per task. Get the task green
   with the oracle locally before spending a run.

## The evaluation pipeline

Each layer gates the next:

1. Proposal (automated gate)
2. Pull request
3. Validity check (automated LLM check on the PR)
4. Pass@2 at your timeout. If EITHER trial times out, the task is rejected.
5. Automated Review (gap-rubric LLM review). Fix every Blocking Issue and push before
   it passes. Ready = green checks plus a PASS verdict.
6. Pass@5 at your timeout. Runs ONLY after Pass@2 produced a valid run and the
   Automated Review passed. If it fails the gate, fix and push; the pipeline re-runs.

Reading results: the github-actions bot posts a **Pre-check (pass@2)** comment. Open
it, expand "Pass@ Analysis — Model A", click "View logs & artifacts", then on the run
Summary page scroll to the artifacts list. Download `pass2-output` for trial logs;
`qc-eval-results` and `qc-exec-results` hold QC output. Artifacts expire, so download
soon or re-run.

## Pre-submit checklist (all four must pass; do NOT submit otherwise)

1. `harbor run -p . --agent oracle` → reward 1.0; `harbor run -p . --agent nop` → < 1.0.
2. `[agent].timeout_sec` matches the "You have N seconds…" line in instruction.md and
   is justified by the oracle's actual runtime with headroom, not padded.
3. Pass@2 cleared at ≤ 3600s without timeouts.
4. Pass@5 in the 0–2/5 band, recorded in the PR. (3–5/5 means too easy. A 0/5 from
   timeouts or ambiguity is broken. Neither may be submitted.)

## Push and open the PR

```bash
git add -A && git commit -m "Task submission"
git push -u origin submission
gh pr create --repo handshake-project-dynamo/<your-task-repo> --fill
# iterate: edit, git add -A && git commit -m "Address review feedback", git push
```

Use the PR description template from the dynamo-create-task skill. Checks re-run on
every push and update their PR comments in place.

## Platform steps (after PR checks go green)

1. Confirm the PR is green on GitHub first.
2. Walk the platform checklist item by item. Add reviewer notes covering anything
   subtle or non-obvious.
3. Screenshot the pass@ results comment on the PR, attach it on the platform, and
   enter the pass@ score.
4. Read the pass@ Job Analysis before submitting. A failed run alone is not enough;
   use the analysis to improve the task first.

## Reading pass@5 results

| Result | Meaning | Outcome |
|--------|---------|---------|
| 0/5 valid failures (oracle passes, no timeouts/errors) | Fully stumped | Accepted |
| 0/5 invalid failures (timeout, agent/verifier error, ambiguous prompt) | Broken, not hard | Rejected: fix the cause |
| 1–2/5 | Solvable and hard, failures valid | Accepted |
| 3–5/5 | Too easy | Rejected: raise difficulty with edge cases, multi-step reasoning, or a stronger verifier. NEVER lower the timeout or add busywork |

Fixing invalid-failure causes: timeout → move difficulty into reasoning, trim
expensive steps, raise the timeout only if justified at ≤ 3600. Ambiguous prompt →
tighten it to one reasonable interpretation. Brittle verifier → make it test the real
requirement and accept any sound correct answer. Not solvable → run the oracle in a
clean container until it reaches reward 1.0.

Source: https://project-dynamo.learn.joinhandshake.com/submit/pass-at (captured 2026-07-08).
