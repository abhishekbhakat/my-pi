---
name: dynamo-review
description: "Review a Terminal-Bench 2 (TB2) / Project Dynamo task as a Review 1 (R1) or Review 2 (R2) reviewer: reach the correct Accept / Revise / Reject verdict, score 1-5, pick issue checkboxes, and record the review in HAI. Also covers how to stump the model (stumping patterns A-I) for reviewing others' tasks, self-review before submitting, and difficulty design as an author. Use when acting as a reviewer, preparing a self-review, or designing task difficulty."
---

Review a TB2 task, or self-review your own before submitting. Every submission gets
two platform reviews: R1 makes the call, R2 confirms it. A review is reading and
judgment only. The automated layers have already built the image, run the oracle,
run the gap-rubric review, and executed pass@5. You catch what machines miss:
coherence across files, real difficulty, realism, ambiguity, verifier robustness,
solvability as packaged. Full page text: `reference/15b-reviewing-guidelines.md`,
`15b-reviewing-judgment.md`, `15b-reviewing-scoring.md`, `15b-reviewing-recording.md`,
`14-stump-the-model.md`.

## The 12 judgment areas

Each failing area maps to an issue checkbox. Judge each one with the rigor you would
apply to this work professionally.

1. **Coherence.** instruction.md, solve.sh, tests/, and the Dockerfile describe and
   serve the same task. Pieces that drift apart mean a broken task even if each file
   looks fine alone.
2. **Solvable.** solve.sh solves the STATED problem, not a narrower one.
3. **Hard for an expert.** Real reasoning or design judgment, not tedium, volume, or
   obscure recall.
4. **Not kitchen-sink.** Difficulty must not come from piling on dozens of interacting
   rules.
5. **Realistic.** A practitioner would be paid to produce these outputs.
6. **Novel.** Not a textbook or published problem a model could reproduce from memory.
7. **Instruction not over-directed.** It must not hand over the method, mandate a
   tool, or walk through steps.
8. **Unambiguous.** Name a sound expert approach that would FAIL verification. If you
   can, the task is underspecified. Arbitrary choices the agent must match must be
   disclosed.
9. **No hidden knowledge.** The solution uses only what the agent can see.
10. **No incorrect or irrelevant info.** No wrong paths, contradictions, or misleading
    filler.
11. **No leakage or misdirection.** Readable files (docstrings, comments, READMEs) must
    not disclose the bug, fix, or expected output, and no undisclosed file may steer
    the agent wrong.
12. **Verifier quality.** Tolerances let a sound alternative method pass (not too
    tight) and reject wrong-but-close answers (not too loose). No domain-specific
    cheat path. Tests match the instruction 1:1. No injection or malicious content.
    Deterministic.

Omission is not automatically ambiguity. The instruction should not hand-hold; an
omitted detail is fine when a domain expert could deduce it from the inputs or
standard domain knowledge. It becomes underspecification only when the missing
detail is an arbitrary, non-standard choice the agent must match but cannot deduce.

## Valid vs invalid failures

A failure is VALID only when you can point to something concrete (a sentence in the
instruction, an analysis of inputs) proving the agent's approach was wrong. If an
expert could defend the approach from the instruction alone, the task is ambiguous
and the failure is INVALID, even when the trial-analysis panel calls it valid. Treat
the trial analysis panel (Per-Trajectory Rubric, Fail Reasons, Golden vs Agent
values, Validity-of-Agent-Approach) as an LLM first pass, not ground truth. Fast
diagnostic: if the failing tests concern file existence or output formatting, the
cause is usually a naming convention the instruction never disclosed. That is
ambiguity, not difficulty.

Two pass@5 outcomes ALWAYS go back to the fellow:

1. 0/5 from invalid failures (timeout, ambiguity, brittle verifier): send back to fix
   the cause.
2. 3–5/5 (pass@5 > 2/5): too easy. Tell the fellow to raise real difficulty (edge
   cases, multi-step reasoning, stronger verifier), never to lower the timeout or add
   busywork.

Other send-back triggers: agent consensus differing from golden (check whether golden
itself is wrong); a verifier that rejects valid sound approaches; an unjustified
timeout or one over 3600s; agent traces showing reward hacking.

## Scoring: checkboxes, 1–5 quality, verdict

**Checkboxes.** Select all that apply:

- Instructions overspecified / underspecified
- Verifiers too tight / Verifiers too loose
- Task is not realistic
- Instruction contains incorrect or irrelevant info
- Metadata labels missing, placeholder, or wrong fit
- "This task is good. Send it forward" (only when you would ship it as-is)
- Other (add comments)

Comments must be actionable. Point at the exact file, criterion, or line and say what
to change. Write "the [29,31] band rejects a valid trapezoidal-rule result; widen to
[28,32] or justify the restriction", not "verifier seems off".

**Quality score (1–5)** tracks the verdict but you set the two independently: the
score records quality on arrival, the verdict records salvageability.

| Score | Case | Verdict |
|-------|------|---------|
| 5 | No issues | Accept |
| 4 | Minor non-blocking issue (typos, grammar, one very minor requirement of many left untested) | Accept |
| 3 | No issues except the task belongs to a different category than the platform records | Accept |
| 3 | Blocking-but-fixable issue that keeps the task's difficulty intact (ambiguity, incorrect facts, leaked fragments, missing files) | Revise |
| 2 | Major issue blocking delivery, difficulty intact | Revise |
| 2 | Issue that flips the difficulty or forces a fresh start | Reject |
| 1 | Attempter ignored or disputed valid feedback without addressing it | Reject |
| 1 | Egregious LLM use, spam, highly misaligned | Reject |

Score 2 with Revise is a normal, intended outcome: poor quality on arrival, but worth
fixing. Score 1 is reserved for bad faith, not poor work.

**The verdict:**

1. **Accept** requires zero issues flagged. Anything else is not a valid Accept.
2. **Revise** for a fixable problem that keeps the task hard after the fix. Send back
   with actionable feedback.
3. **Reject** when the difficulty is illegitimate or the task is unsalvageable. Reject
   when any of these hold: undisclosed requirements caused most failures; clarifying
   an ambiguous term would let the model pass; the agent made a valid choice the
   instruction never pinned (ordering, naming, formatting); deliberate red herrings
   mislead the agent; the commit history shows a clarifying instruction was removed
   to manufacture failure; trials failed on incorrect undisclosed information; an
   overly strict verifier rejected all valid answers; the fix requires restarting
   from scratch; or the attempter ignored previous feedback without addressing it.

The Revise-vs-Reject call comes down to one question: if you fix the defect, is the
task still hard? Yes → Revise. The fix makes it easy → Reject.

## Recording your review in HAI (R1 form, fill in order)

1. **R1 Reviewed PR Commit Hash.** Copy the exact latest commit hash you reviewed. R2
   checks your review against this hash.
2. **Standard Quality Score – Review 1.** Rate 1–5 as received.
3. **Review 1 Task Verdict.** Accept / Revise / Reject. Click Approve ONLY when the
   verdict is Accept and zero issues are flagged. For Revise or Reject: flag the
   issues, leave feedback, and wait for the gray send-back option. Clicking Approve
   routes the task forward instead of back to the fellow; this has gone wrong before.
4. **Review 1 Fellow Verdict.** Rates the fellow, not the task: Excellent / Trainable
   / Misaligned.
5. **Task Notes and Feedback.** Flag every issue as minor or major so comments become
   blocking. Leave feedback in two places: the taxonomy comment field and inline
   file-bubble comments. A practical pattern: write one paragraph listing all issues,
   then file each issue as its own bubble. Give feedback even on a Reject, so the
   fellow avoids repeating the mistake.

## Before you judge

1. Read the approved proposal and the fellow's task notes. Open the full task repo:
   instruction.md, task.toml explanations, environment/, solution/, tests/, Dockerfile.
2. Note the exact latest commit hash for the HAI record.
3. Skim the PR commit history for manufactured difficulty, such as a clarifying
   instruction removed so passing trials start failing.
4. Check previous reviewer feedback; confirm the fellow made the required changes.
5. Open the pass@5 analysis comment on the PR and note the recorded score.
6. Read the static-check notes. Treat green as a hint, not a verdict; your own read
   overrides it in both directions.

## Stumping patterns A–I (designing difficulty fairly)

A good stump does not make a task broadly hard. The agent completes 90% of the work
correctly, then fails on one decisive point that has exactly one right answer but
cannot be pattern-matched, recalled, or self-verified. Every pattern is fair only
when the contract pins a single defensible answer. As an author, design with these.
As a reviewer, check the task stays inside the fairness line.

- **A · Latent crux.** The deciding case never appears in the data the agent sees.
  The sample is homogeneous along the one axis that matters; the held-out cases
  differ. The more carefully the agent validates against the sample, the more
  confident it becomes in the wrong answer.
- **B · Wrong-default lure.** An obvious, cheap heuristic almost equals the correct
  but expensive rule. The gap appears only on cases the agent has no reason to
  suspect.
- **C · Misdirection.** The environment points at the wrong answer: a planted
  diagnostic tool, misleading comments, decoy files, stale official-sounding docs.
  Correct behavior requires distrusting the convenient conclusion.
- **D · Evidence-forced reverse engineering.** The agent recovers an undocumented rule
  from observable data: sentinel values, unit conventions, byte order. The answer
  must be discoverable from material the agent can read, even if discovery takes
  real work.
- **E · Ordering assumption.** The data violates an invariant the agent never
  consciously chose ("input is sorted", "records are well-formed"). The natural
  implementation reproduces the sample and fails the held-out.
- **F · Discovery-hop.** A final opaque guess with no partial feedback. Fair only when
  the value is hinted or derivable somewhere; otherwise the task tests luck.
- **G · Multi-mechanism accumulation.** Many independent fixes, all required, under an
  all-or-nothing bar.
- **H · Entangled rules.** Each rule is simple, but rules reach back and change each
  other (resets, revocations, bitemporal data). The incremental implementation is
  exactly the one that misses the interactions.
- **I · Stale authority.** The "current" value is wrong for time-scoped lookups; only
  the value authoritative as of the cutoff is right. Point-in-time joins,
  effective-date vs posting-date, superseding versions.

Stump vs defect: a verifier accepting a wide band (for example, any standard error
between 0.5x and 2.5x the reference) signals that the contract never pinned what
"correct" means. That is a defect, and it routes to rejection, not difficulty credit.

Source: https://project-dynamo.learn.joinhandshake.com/reviewing/guidelines (captured 2026-07-08).
