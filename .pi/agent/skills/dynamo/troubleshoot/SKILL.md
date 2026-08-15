---
name: dynamo-troubleshoot
description: "Diagnose and fix Terminal-Bench 2 (TB2) / Project Dynamo task failures: QC evaluation flags (30 Major checks, families A-E), AVA (Adversarial Verifier Audit) rejections, pre-submit self-check, and practice exercises. Use when QC eval fail, AVA send back submission, platform reviewer flag issues, or you need to check whether task have leaked answers, nondeterminism, or weak verifier."
---

Find why TB2 task fail review and fix it. Dynamo QC evaluation is adversarial:
it assume your task should FAIL until it can verify every requirement. One failed
Major check fail whole task. Full page text with worked failed/passed examples:
`reference/16-pitfalls-qc-eval.md`, `16-pitfalls-ava.md`, `16-pitfalls-checklist.md`,
`17-practice-requirements.md`, `18-practice-symlinking.md`.

Core principle: agent must be able to derive everything verifier grade
from instruction.md, environment/, and shipped examples, and verifier must enforce
every structural requirement direct, not through proxy. Design backward from this.

## 30 QC checks (families A–E; each one is Major)

**A · Solution/oracle correctness (A1–A6)**
A1 oracle fail its own verifier · A2 solution skip actions instruction require ·
A3 hardcoded answer in reference · A4 oracle use hidden/privileged access ·
A5 oracle rely on undocumented assumption that change result ·
A6 oracle have edge-case or logic bug

**B · Contract coherence & determinacy (B1–B6)**
B1 ambiguous rule with no disambiguation · B2 internal contradiction or impossible
mechanism · B3 missing definition, field, or data in agent-visible inputs ·
B4 verifier enforce requirement stated nowhere (hidden thresholds, undisclosed
encodings) · B5 underdetermined or hidden-knowledge mapping · B6 unstated
data-anomaly policy

**C · Verifier rigor & scoring (C1–C6)**
C1 stub, partial, or degenerate output accepted · C2 over-permissive tolerance or
threshold · C3 narrow held-out coverage (hardcoded constant pass) ·
C4 ground truth recomputed from agent-writable inputs · C5 NaN/Infinity bypass ·
C6 scoring mismatch (binary reward vs promised partial credit)

**D · Fixtures, environment & determinism (D1–D5)**
D1 degenerate fixture (no-op already pass) · D2 malformed fixture ·
D3 build failure · D4 nondeterminism (unseeded RNG, time.time(), network calls,
dict/set iteration order) · D5 unseeded build-time randomness

**E · Anti-cheat & isolation (E1–E7)**
E1 oracle or answers readable by agent during run · E2 immutable-input
integrity not enforced · E3 reward plumbing exploit (verifier import or execute
agent-writable file) · E4 root access expose secrets · E5 symlinked output path ·
E6 unsafe archive extraction · E7 deliverable that merely invoke copied oracle

## Six defenses gate reward

1. **Put every graded decision in agent-visible material** (cover A3, A5, B3, B4;
   most common flag cause). Every constant, threshold, tie-break, and ordering
   verifier use must trace to line in instruction.md or environment/. If
   mechanism must be learned rather than told, say so and ship enough data to pin
   it unique.
2. **Enforce structure, not aggregates** (C1, C2). Assert each structural requirement:
   count, shape, keys, ordering, byte-exactness. Try to build wrong-shape answer
   that clear your metric. If you can, agent can too.
3. **Protect ground truth in code** (C4, E1, E2, E5). Grade from /tests, or recompute
   truth from inputs agent cannot write. Open graded output paths with symlink
   guards (O_NOFOLLOW). Hash-pin protected inputs. Never COPY solution/ or tests/.
4. **Make pipeline deterministic** (A1, D3–D5). Fixed seed on every graded RNG.
   No time, network, or iteration-order dependence. Pinned dependencies. Oracle
   score full reward against verifier exactly as shipped.
5. **Ship complete reference that derive its own answer** (A2, A4, B5). Oracle
   perform every required action and derive its answer from agent-visible inputs,
   with no hidden module supply crux unless shipped data let you
   reconstruct it.
6. **State handling rule for every data anomaly** (B6): duplicates, ties, malformed
   rows.

## AVA: Adversarial Verifier Audit

AVA work blind. It reconstruct what your verifier accept without trust your
reference solution, then attack pass/fail boundary. It return `pass` or
`block`. Major findings block PR; Minor findings are advisory. Empty or
unparseable output count as fail (fail-closed). AVA run after Pass@2 and gate
Pass@5. AVA and Deep-Review (Automated Review) form union: both must pass.

Verifier boundaries slip two ways:

1. **False accept (too loose).** Stub or hardcoded answer earn reward 1. AVA hunt
   this first.
2. **False reject (too strict).** Valid, spec-faithful submission fail on tight
   formatting, ordering, or float tolerance.

Classic Major finding: ground truth at path agent can read.

```python
# BAD:  agent can open (or overwrite) the answer key
expected = np.load("/app/reference_data.npz")
# GOOD: truth lives where the submission cannot reach it
expected = np.load("/tests/private/reference_data.npz")
```

Pass AVA by be your own AVA before you push:

1. Write stub, hardcoded, or fixture-echo submission that pass without real work.
   If you can build one, so can AVA.
2. Confirm few valid-but-differently-shaped correct answers all pass.
3. Re-read your reference solution against instructions: it must obey stated
   method, not only hit expected output.

## Symlink cheat

Verifier open output paths instruction.md name, but agent control
those paths. Instead of do work, agent replace output with SYMLINK
to answer key (/tests/, /solution/, or sibling expected/). `os.path.exists` and
`is_file()` follow symlinks, so they catch nothing. Two defenses:

1. Load truth independent, from location agent process cannot reach.
2. Treat every output path as untrusted: confirm it is not symlink and that it
   resolve inside agent own tree.

```python
import os
p = "/app/output/clean.csv"
assert not os.path.islink(p)                    # real file, not a redirect
assert os.path.realpath(p).startswith("/app/")  # inside the agent's tree
actual = open(p).read()
expected = load_expected_from_sealed_fixture()  # truth loaded independently
assert actual == expected
```

Subtler leak: do not re-run agent own code at verify time. Harbor mount
/tests before grading, so agent code executed at grade time can open /tests/... and
copy golden answers. Grade files already on disk; only your harness run at verify
time. This leak also mask bugs in your own reference, because copying "solution"
never exercise real logic.

## 15-item pre-submission checklist

1. All verifier rules stated in instruction.md or derivable from environment/:
   constants, thresholds, tie-breaks, ordering, units (A3, A5, B3, B4)
2. Nothing graded live only in solution/ or tests/
3. Learnable mechanisms flagged in instruction, with shipped data that pin every
   graded answer (B5)
4. Verifier enforce every structural requirement, not one aggregate metric (C1, C2)
5. You tried to build degenerate answer that clear metric, and could not
   (C1–C3, D1)
6. Graded numeric fields reject NaN and Infinity (C5)
7. Reward scheme match stated grading (C6)
8. Ground truth come from /tests or non-agent-writable inputs; no agent-writable
   path feed expected answer (C4, E2)
9. Graded output paths opened with O_NOFOLLOW; protected inputs hash-pinned (E5, E2)
10. solution/ and tests/ never COPY'd into agent image (E1)
11. No reference tool or oracle copy left for agent to invoke (E7)
12. All RNGs on graded paths seeded with fixed defaults; no time, network, or
    iteration-order nondeterminism; dependencies pinned (D3–D5)
13. Oracle score full reward against verifier exactly as shipped (A1)
14. solution/ perform every action instruction require (A2)
15. Every data anomaly (duplicates, ties, malformed rows) have stated, enforced
    handling rule (B6)

Also run 11-item human-judgment self-check in
`reference/16-pitfalls-checklist.md`. It cover: every output field format fully
specified (IDs, enums, exact literals); canonical rule named whenever value can
be computed more than one valid way; no leaked answers in any readable file; solver
output re-read against instruction.md 1:1; and, for each assertion, "no" to
question "could someone fake this and still pass?"

Source: https://project-dynamo.learn.joinhandshake.com/pitfalls/qc-eval (captured 2026-07-08).
