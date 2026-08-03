---
name: dynamo-troubleshoot
description: "Diagnose and fix Terminal-Bench 2 (TB2) / Project Dynamo task failures: QC evaluation flags (30 Major checks, families A-E), AVA (Adversarial Verifier Audit) rejections, pre-submit self-check, and practice exercises. Use when QC eval fails, AVA sends back a submission, the platform reviewer flags issues, or you need to check whether a task has leaked answers, nondeterminism, or a weak verifier."
---

Find why a TB2 task fails review and fix it. The Dynamo QC evaluation is adversarial:
it assumes your task should FAIL until it can verify every requirement. One failed
Major check fails the whole task. Full page text with worked failed/passed examples:
`reference/16-pitfalls-qc-eval.md`, `16-pitfalls-ava.md`, `16-pitfalls-checklist.md`,
`17-practice-requirements.md`, `18-practice-symlinking.md`.

The core principle: the agent must be able to derive everything the verifier grades
from instruction.md, environment/, and shipped examples, and the verifier must enforce
every structural requirement directly, not through a proxy. Design backward from this.

## The 30 QC checks (families A–E; each one is Major)

**A · Solution/oracle correctness (A1–A6)**
A1 oracle fails its own verifier · A2 solution skips actions the instruction requires ·
A3 hardcoded answer in the reference · A4 oracle uses hidden/privileged access ·
A5 oracle relies on an undocumented assumption that changes the result ·
A6 oracle has an edge-case or logic bug

**B · Contract coherence & determinacy (B1–B6)**
B1 ambiguous rule with no disambiguation · B2 internal contradiction or impossible
mechanism · B3 missing definition, field, or data in agent-visible inputs ·
B4 verifier enforces a requirement stated nowhere (hidden thresholds, undisclosed
encodings) · B5 underdetermined or hidden-knowledge mapping · B6 unstated
data-anomaly policy

**C · Verifier rigor & scoring (C1–C6)**
C1 stub, partial, or degenerate output accepted · C2 over-permissive tolerance or
threshold · C3 narrow held-out coverage (a hardcoded constant passes) ·
C4 ground truth recomputed from agent-writable inputs · C5 NaN/Infinity bypass ·
C6 scoring mismatch (binary reward vs promised partial credit)

**D · Fixtures, environment & determinism (D1–D5)**
D1 degenerate fixture (the no-op already passes) · D2 malformed fixture ·
D3 build failure · D4 nondeterminism (unseeded RNG, time.time(), network calls,
dict/set iteration order) · D5 unseeded build-time randomness

**E · Anti-cheat & isolation (E1–E7)**
E1 oracle or answers readable by the agent during the run · E2 immutable-input
integrity not enforced · E3 reward plumbing exploit (the verifier imports or executes
an agent-writable file) · E4 root access exposes secrets · E5 symlinked output path ·
E6 unsafe archive extraction · E7 deliverable that merely invokes a copied oracle

## The six defenses the gate rewards

1. **Put every graded decision in agent-visible material** (covers A3, A5, B3, B4;
   the most common flag cause). Every constant, threshold, tie-break, and ordering
   the verifier uses must trace to a line in instruction.md or environment/. If a
   mechanism must be learned rather than told, say so and ship enough data to pin
   it uniquely.
2. **Enforce structure, not aggregates** (C1, C2). Assert each structural requirement:
   count, shape, keys, ordering, byte-exactness. Try to build a wrong-shape answer
   that clears your metric. If you can, the agent can too.
3. **Protect ground truth in code** (C4, E1, E2, E5). Grade from /tests, or recompute
   truth from inputs the agent cannot write. Open graded output paths with symlink
   guards (O_NOFOLLOW). Hash-pin protected inputs. Never COPY solution/ or tests/.
4. **Make the pipeline deterministic** (A1, D3–D5). Fixed seed on every graded RNG.
   No time, network, or iteration-order dependence. Pinned dependencies. The oracle
   scores full reward against the verifier exactly as shipped.
5. **Ship a complete reference that derives its own answer** (A2, A4, B5). The oracle
   performs every required action and derives its answer from agent-visible inputs,
   with no hidden module supplying the crux unless the shipped data lets you
   reconstruct it.
6. **State a handling rule for every data anomaly** (B6): duplicates, ties, malformed
   rows.

## AVA: the Adversarial Verifier Audit

AVA works blind. It reconstructs what your verifier accepts without trusting your
reference solution, then attacks the pass/fail boundary. It returns `pass` or
`block`. Major findings block the PR; Minor findings are advisory. Empty or
unparseable output counts as fail (fail-closed). AVA runs after Pass@2 and gates
Pass@5. AVA and Deep-Review (the Automated Review) form a union: both must pass.

Verifier boundaries slip two ways:

1. **False accept (too loose).** A stub or hardcoded answer earns reward 1. AVA hunts
   this first.
2. **False reject (too strict).** A valid, spec-faithful submission fails on tight
   formatting, ordering, or float tolerance.

A classic Major finding: ground truth at a path the agent can read.

```python
# BAD:  agent can open (or overwrite) the answer key
expected = np.load("/app/reference_data.npz")
# GOOD: truth lives where the submission cannot reach it
expected = np.load("/tests/private/reference_data.npz")
```

Pass AVA by being your own AVA before you push:

1. Write a stub, hardcoded, or fixture-echo submission that passes without real work.
   If you can build one, so can AVA.
2. Confirm a few valid-but-differently-shaped correct answers all pass.
3. Re-read your reference solution against the instructions: it must obey the stated
   method, not only hit the expected output.

## The symlink cheat

The verifier opens the output paths instruction.md names, but the agent controls
those paths. Instead of doing the work, the agent replaces an output with a SYMLINK
to the answer key (/tests/, /solution/, or a sibling expected/). `os.path.exists` and
`is_file()` follow symlinks, so they catch nothing. Two defenses:

1. Load truth independently, from a location the agent's process cannot reach.
2. Treat every output path as untrusted: confirm it is not a symlink and that it
   resolves inside the agent's own tree.

```python
import os
p = "/app/output/clean.csv"
assert not os.path.islink(p)                    # real file, not a redirect
assert os.path.realpath(p).startswith("/app/")  # inside the agent's tree
actual = open(p).read()
expected = load_expected_from_sealed_fixture()  # truth loaded independently
assert actual == expected
```

A subtler leak: do not re-run the agent's own code at verify time. Harbor mounts
/tests before grading, so agent code executed at grade time can open /tests/... and
copy golden answers. Grade files already on disk; only your harness runs at verify
time. This leak also masks bugs in your own reference, because a copying "solution"
never exercises the real logic.

## 15-item pre-submission checklist

1. All verifier rules stated in instruction.md or derivable from environment/:
   constants, thresholds, tie-breaks, ordering, units (A3, A5, B3, B4)
2. Nothing graded lives only in solution/ or tests/
3. Learnable mechanisms flagged in the instruction, with shipped data that pins every
   graded answer (B5)
4. Verifier enforces every structural requirement, not one aggregate metric (C1, C2)
5. You tried to build a degenerate answer that clears the metric, and could not
   (C1–C3, D1)
6. Graded numeric fields reject NaN and Infinity (C5)
7. Reward scheme matches the stated grading (C6)
8. Ground truth comes from /tests or non-agent-writable inputs; no agent-writable
   path feeds the expected answer (C4, E2)
9. Graded output paths opened with O_NOFOLLOW; protected inputs hash-pinned (E5, E2)
10. solution/ and tests/ never COPY'd into the agent image (E1)
11. No reference tool or oracle copy left for the agent to invoke (E7)
12. All RNGs on graded paths seeded with fixed defaults; no time, network, or
    iteration-order nondeterminism; dependencies pinned (D3–D5)
13. The oracle scores full reward against the verifier exactly as shipped (A1)
14. solution/ performs every action the instruction requires (A2)
15. Every data anomaly (duplicates, ties, malformed rows) has a stated, enforced
    handling rule (B6)

Also run the 11-item human-judgment self-check in
`reference/16-pitfalls-checklist.md`. It covers: every output field's format fully
specified (IDs, enums, exact literals); a canonical rule named whenever a value can
be computed more than one valid way; no leaked answers in any readable file; solver
output re-read against instruction.md 1:1; and, for each assertion, a "no" to the
question "could someone fake this and still pass?"

Source: https://project-dynamo.learn.joinhandshake.com/pitfalls/qc-eval (captured 2026-07-08).
