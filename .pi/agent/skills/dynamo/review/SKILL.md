---
name: dynamo-review
description: "Review Terminal-Bench 2 (TB2) / Project Dynamo task as Review 1 (R1) or Review 2 (R2) reviewer: reach correct Accept / Revise / Reject verdict, score 1-5, pick issue checkboxes, and record review in HAI. Also cover how to stump model (stumping patterns A-I) for review others' tasks, self-review before submit, and difficulty design as author. Use when act as reviewer, prepare self-review, or design task difficulty."
---

Review TB2 task, or self-review your own before submit. Every submission get
two platform reviews: R1 make call, R2 confirm it. Review is reading and
judgment only. Automated layers already built image, run oracle,
run gap-rubric review, and execute pass@5. You catch what machines miss:
coherence across files, real difficulty, realism, ambiguity, verifier robustness,
solvability as packaged. Full page text: `reference/15b-reviewing-guidelines.md`,
`15b-reviewing-judgment.md`, `15b-reviewing-scoring.md`, `15b-reviewing-recording.md`,
`14-stump-the-model.md`.

## 12 judgment areas

Each failing area map to issue checkbox. Judge each one with rigor you would
apply to this work professional.

1. **Coherence.** instruction.md, solve.sh, tests/, and Dockerfile describe and
   serve same task. Pieces that drift apart mean broken task even if each file
   look fine alone.
2. **Solvable.** solve.sh solve STATED problem, not narrower one.
3. **Hard for expert.** Real reasoning or design judgment, not tedium, volume, or
   obscure recall.
4. **Not kitchen-sink.** Difficulty must not come from pile on dozens of interacting
   rules.
5. **Realistic.** Practitioner would be paid to produce these outputs.
6. **Novel.** Not textbook or published problem model could reproduce from memory.
7. **Instruction not over-directed.** It must not hand over method, mandate
   tool, or walk through steps.
8. **Unambiguous.** Name sound expert approach that would FAIL verification. If you
   can, task is underspecified. Arbitrary choices agent must match must be
   disclosed.
9. **No hidden knowledge.** Solution use only what agent can see.
10. **No incorrect or irrelevant info.** No wrong paths, contradictions, or misleading
    filler.
11. **No leakage or misdirection.** Readable files (docstrings, comments, READMEs) must
    not disclose bug, fix, or expected output, and no undisclosed file may steer
    agent wrong.
12. **Verifier quality.** Tolerances let sound alternative method pass (not too
    tight) and reject wrong-but-close answers (not too loose). No domain-specific
    cheat path. Tests match instruction 1:1. No injection or malicious content.
    Deterministic.

Omission is not automatic ambiguity. Instruction should not hand-hold; omitted
detail is fine when domain expert could deduce it from inputs or
standard domain knowledge. It become underspecification only when missing
detail is arbitrary, non-standard choice agent must match but cannot deduce.

## Valid vs invalid failures

Failure is VALID only when you can point to something concrete (sentence in
instruction, analysis of inputs) prove agent approach was wrong. If expert
could defend approach from instruction alone, task is ambiguous
and failure is INVALID, even when trial-analysis panel call it valid. Treat
trial analysis panel (Per-Trajectory Rubric, Fail Reasons, Golden vs Agent
values, Validity-of-Agent-Approach) as LLM first pass, not ground truth. Fast
diagnostic: if failing tests concern file existence or output formatting, cause
is usually naming convention instruction never disclosed. That is
ambiguity, not difficulty.

Two pass@5 outcomes ALWAYS go back to fellow:

1. 0/5 from invalid failures (timeout, ambiguity, brittle verifier): send back to fix
   cause.
2. 3–5/5 (pass@5 > 2/5): too easy. Tell fellow to raise real difficulty (edge
   cases, multi-step reasoning, stronger verifier), never to lower timeout or add
   busywork.

Other send-back triggers: agent consensus differ from golden (check whether golden
itself is wrong); verifier that reject valid sound approaches; unjustified
timeout or one over 3600s; agent traces show reward hacking.

## Scoring: checkboxes, 1–5 quality, verdict

**Checkboxes.** Select all that apply:

- Instructions overspecified / underspecified
- Verifiers too tight / Verifiers too loose
- Task is not realistic
- Instruction contain incorrect or irrelevant info
- Metadata labels missing, placeholder, or wrong fit
- "This task is good. Send it forward" (only when you would ship it as-is)
- Other (add comments)

Comments must be actionable. Point at exact file, criterion, or line and say what
to change. Write "the [29,31] band reject valid trapezoidal-rule result; widen to
[28,32] or justify restriction", not "verifier seems off".

**Quality score (1–5)** track verdict but you set two independent: score
record quality on arrival, verdict record salvageability.

| Score | Case | Verdict |
|-------|------|---------|
| 5 | No issues | Accept |
| 4 | Minor non-blocking issue (typos, grammar, one very minor requirement of many left untested) | Accept |
| 3 | No issues except task belong to different category than platform record | Accept |
| 3 | Blocking-but-fixable issue that keep task difficulty intact (ambiguity, incorrect facts, leaked fragments, missing files) | Revise |
| 2 | Major issue blocking delivery, difficulty intact | Revise |
| 2 | Issue that flip difficulty or force fresh start | Reject |
| 1 | Attempter ignore or dispute valid feedback without address it | Reject |
| 1 | Egregious LLM use, spam, highly misaligned | Reject |

Score 2 with Revise is normal, intended outcome: poor quality on arrival, but worth
fixing. Score 1 reserved for bad faith, not poor work.

**Verdict:**

1. **Accept** require zero issues flagged. Anything else is not valid Accept.
2. **Revise** for fixable problem that keep task hard after fix. Send back
   with actionable feedback.
3. **Reject** when difficulty is illegitimate or task is unsalvageable. Reject
   when any of these hold: undisclosed requirements cause most failures; clarify
   ambiguous term would let model pass; agent made valid choice
   instruction never pinned (ordering, naming, formatting); deliberate red herrings
   mislead agent; commit history show clarifying instruction was removed
   to manufacture failure; trials fail on incorrect undisclosed information; overly
   strict verifier reject all valid answers; fix require restart
   from scratch; or attempter ignore previous feedback without address it.

Revise-vs-Reject call come down to one question: if you fix defect, is
task still hard? Yes: Revise. Fix make it easy: Reject.

## Recording review in HAI (R1 form, fill in order)

1. **R1 Reviewed PR Commit Hash.** Copy exact latest commit hash you reviewed. R2
   check your review against this hash.
2. **Standard Quality Score – Review 1.** Rate 1–5 as received.
3. **Review 1 Task Verdict.** Accept / Revise / Reject. Click Approve ONLY when
   verdict is Accept and zero issues are flagged. For Revise or Reject: flag
   issues, leave feedback, and wait for gray send-back option. Click Approve
   route task forward instead of back to fellow; this have gone wrong before.
4. **Review 1 Fellow Verdict.** Rate fellow, not task: Excellent / Trainable
   / Misaligned.
5. **Task Notes and Feedback.** Flag every issue as minor or major so comments become
   blocking. Leave feedback in two places: taxonomy comment field and inline
   file-bubble comments. Practical pattern: write one paragraph list all issues,
   then file each issue as its own bubble. Give feedback even on Reject, so
   fellow avoid repeat mistake.

## Before you judge

1. Read approved proposal and fellow task notes. Open full task repo:
   instruction.md, task.toml explanations, environment/, solution/, tests/, Dockerfile.
2. Note exact latest commit hash for HAI record.
3. Skim PR commit history for manufactured difficulty, such as clarifying
   instruction removed so passing trials start failing.
4. Check previous reviewer feedback; confirm fellow made required changes.
5. Open pass@5 analysis comment on PR and note recorded score.
6. Read static-check notes. Treat green as hint, not verdict; your own read
   override it in both directions.

## Stumping patterns A–I (design difficulty fair)

Good stump do not make task broadly hard. Agent complete 90% of work
correct, then fail on one decisive point that have exactly one right answer but
cannot be pattern-matched, recalled, or self-verified. Every pattern is fair only
when contract pin single defensible answer. As author, design with these.
As reviewer, check task stay inside fairness line.

- **A · Latent crux.** Deciding case never appear in data agent see.
  Sample is homogeneous along one axis that matter; held-out cases
  differ. More carefully agent validate against sample, more
  confident it become in wrong answer.
- **B · Wrong-default lure.** Obvious, cheap heuristic almost equal correct
  but expensive rule. Gap appear only on cases agent have no reason to
  suspect.
- **C · Misdirection.** Environment point at wrong answer: planted
  diagnostic tool, misleading comments, decoy files, stale official-sounding docs.
  Correct behavior require distrust convenient conclusion.
- **D · Evidence-forced reverse engineering.** Agent recover undocumented rule
  from observable data: sentinel values, unit conventions, byte order. Answer
  must be discoverable from material agent can read, even if discovery take
  real work.
- **E · Ordering assumption.** Data violate invariant agent never
  conscious chose ("input is sorted", "records are well-formed"). Natural
  implementation reproduce sample and fail held-out.
- **F · Discovery-hop.** Final opaque guess with no partial feedback. Fair only when
  value is hinted or derivable somewhere; otherwise task test luck.
- **G · Multi-mechanism accumulation.** Many independent fixes, all required, under
  all-or-nothing bar.
- **H · Entangled rules.** Each rule is simple, but rules reach back and change each
  other (resets, revocations, bitemporal data). Incremental implementation is
  exactly one that miss interactions.
- **I · Stale authority.** "Current" value is wrong for time-scoped lookups; only
  value authoritative as of cutoff is right. Point-in-time joins,
  effective-date vs posting-date, superseding versions.

Stump vs defect: verifier accept wide band (for example, any standard error
between 0.5x and 2.5x reference) signal that contract never pinned what
"correct" mean. That is defect, and it route to rejection, not difficulty credit.

Source: https://project-dynamo.learn.joinhandshake.com/reviewing/guidelines (captured 2026-07-08).
