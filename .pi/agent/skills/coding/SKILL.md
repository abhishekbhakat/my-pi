---
name: coding
description: >-
  Write quality code readable by humans and AI agents, keep agent context lean
  and correct, and review PRs/code with a fixed protocol including a
  production-grade pass via reasoning_coach. Use when writing or refactoring
  code, designing or trimming AGENTS.md/CLAUDE.md, diagnosing repeated agent
  mistakes, cutting context bloat, or when user ask PR review, review pull
  request, merge readiness, review PR #N, production-grade review, or equivalent.
---

# Coding

Quality code for humans and AI agents. Lean context. Single source of truth.

## Priority

- Project AGENTS.md / CLAUDE.md and user instructions win over this skill. Never duplicate project law here.
- Code and runnable checks are truth. Prose, plans, and auto-saved memory are not.

## Principles

1. One source of knowledge. Same fact in two places decays into split-brain; agents follow the stale copy.
2. Remove failure categories in code, not in notes. Architecture, types, and CI beat "do not do X".
3. Values over discipline. Align the agent on what matters (perf, openness, surfaces, taste). Skip imposed human process ritual.
4. Context is spend. Load only what the task needs. Prefer files plus selective reads over bulk dumps.
5. Maintainability is cheap, low-risk change. Next reader (or you in six months) can find, understand, change, and verify without the author. Style, comments, and whitespace are courtesy, not the bar.

## Repo layout

- Layout is context. A stranger running `tree` should infer responsibility from names alone.
- Name folders by ownership, boundary, or capability. Avoid vague buckets: `misc`, `helpers`, `common`, `temp`, `old`, `new`, bare `core`.
- Top level should reveal what the repo does: product domains, shared contracts, adapters, scripts, docs.
- Do not force one taxonomy. Libraries, CLIs, and monorepos need different top levels.
- Keep meaningful depth shallow. If a file needs five levels to justify itself, move it or rename the boundary.
- `shared` or `core` needs a stated contract. One owner. No duplicate truth.
- Apply when creating or already touching a directory. No drive-by reorg.

## Intervention ladder (agent keeps doing wrong thing)

Apply top first. Move down only when the level above cannot kill the problem.

1. **Architecture / data structures** — make the failure impossible. Typed contracts across boundaries, one shared data layer across surfaces, adapter boundary holds complexity, orchestration and UI stay dumb.
2. **Lint / CI / tests** — agent sees the failure before reporting done. Gate real numbers (payload bytes, bundle size, query count) with a ceiling slightly above current baseline.
3. **Skill / short rule** — mostly for process around the code (remote access, release steps), not core domain logic.
4. **Human in the loop** — last resort. Reached often means levels 1-2 are under-built.

Adding a rule without trying levels 1-2 first is a smell.

## Anti-patterns

| Anti-pattern                                     | Why it fails                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------- |
| Auto-saved agent memory of PRs, specs, one-off debug | Writes far outnumber reads; stale state steers future runs wrong |
| Long-lived plan/design markdown in repo          | Decays faster than code; becomes wrong instructions                       |
| Comments explaining past workarounds             | Rot; comments must move with code or die                                  |
| Embeddings/RAG/code-graph retrieval as default   | Models with bash and search navigate code well; unproven lift, real cost. Adopt retrieval only with an eval showing better output |
| Skill or MCP server per integration              | Skills are the fallback after architecture and CI; MCP tends to dump bulk into context. Prefer a small script that writes files |

## Context hygiene

Belongs in durable repo context (AGENTS.md and friends):

- What the product is and what "good" means (open, performance, remote, surfaces)
- Shared glossary; kill invented jargon
- Hard process facts the agent cannot infer (long-lived dev servers, PR title rules)
- Taste rules that change defaults (where complexity lives, inferred types, comments describe use and move with code)
- Short folder map only when repo is huge and the map stays maintained; `tree` should already explain most of it

Must not persist as agent context:

- Point-in-time state: PR numbers, fixed bugs, already-upgraded env versions, unshipped plans
- Anything already stated in AGENTS.md (duplicates decay)
- Full tool output. Write to file, read the slice needed, cap the rest
- Benchmark/setup noise from experiments

## AGENTS.md design

Order matters:

1. **Product identity** — what it is, what it replaces. Agents that do not know the product make wrong suggestions.
2. **What makes it special** — directional rails (open core, perf, remote-ready, multi-surface).
3. **Glossary** — shared language.
4. **Hard stops** — the few behaviors that keep breaking sessions.
5. **Verification** — narrowest checks; no repo-wide sweeps unless asked.
6. **Taste** — patterns to copy, defaults to prefer.

Success bar: agent does the small ask plus the adjacent steps you would have done next, or pushes back usefully. Below that bar, tune the file. Do not add memory.

## Verification

- Narrowest check that catches the class of bug. Test real payload shapes, not vibes.
- Agent fixes CI failures before reporting done.
- Big outputs go to files; report paths, not dumps.

## Review (PR or local code)

Problems only. Repo-agnostic. Correctness pass plus production-grade pass.

### Production-grade bar

Stance: right way, not done-way. A passing happy path is not the bar.

Production-grade means:

- invariants are named and enforceable, not implied by control flow
- failure is named: what happens when X goes wrong, and how we know it broke vs worked
- one model end-to-end across related stores and paths, not only the path that was tested
- operators can enable, roll back, or retry on existing data without a second duplicate wave
- fast path does not silently redefine product policy
- next reader can find, change, and verify with small blast radius. Author-only cleverness is not production-grade.

A greenfield re-run or happy-path count is not production evidence for migration or long-term policy.

Grade each material decision:

| Grade                            | Use when                                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------------------- |
| production-grade (keep)          | Architecture is right. Do not revert it.                                                  |
| sound shape; weak implementation | Right idea or cost model. Not done until the invariant is atomic and skip is not fake-success. |
| not professional                 | Policy by accident. No docs, no escape hatch, or unsafe to enable on existing data.       |
| defect                           | Contradicts another decision in the same change. Split model.                             |

Shipped code that is the faster way is not production-grade. Name both ways per decision. These are common shortcut patterns, not an exhaustive checklist:

1. **Atomic claim.** Faster: lookup then insert. Right: atomic unique claim on the stable identity, without breaking legitimate revisions.
2. **Enable + migrate.** Faster: flag on add / live-tested happy path only. Right: set on existing rows and normalize held keys before the flag is on. Feature you cannot safely turn on for real data is not production-grade.
3. **Silent policy.** Faster: first success or skip becomes forever law. Right: document the policy and add an escape (force-refresh, revalidation), or do not treat first bytes as law.
4. **Outcome honesty.** Faster: reuse success event, counter, or breaker reset for skip. Right: distinct seen/skipped vs fetch success. Freshness, breaker, calibration move only on real work.
5. **Contract width.** Faster: one case's shortcut as the general flag. Right: named params, extractor, or scoped contract. Do not lie with a reusable capability name.
6. **One identity story.** Faster: leave failures, retries, parks, or metrics on the transport id. Right: same identity rule as the stored artifact; transport stays payload.
7. **One canonicalize point.** Faster: assume pre-check key equals store key. Right: canonicalize once after resolve; both paths use it.
8. **Author-only knowledge.** Faster: clever density, workaround comment, duplicate fact, tribal rationale. Right: next reader can find the change site, see why, change it, and verify without the author.

Sound foundations: keep and harden. Do not throw out the right architecture because the implementation is weak.

### Hard order (normative)

1. **Own pass first.** Read PR metadata, diff, changed paths, needed surrounding code. Run focused checks only to verify a suspected issue.
2. **Do not** launch `patch_reviewer` or `reasoning_coach` before own pass finishes.
3. **After own pass:** launch `patch_reviewer` and `reasoning_coach` in parallel with the handoff packets below.
4. **Merge** own findings + both helpers. Single voice. Never attribute to a tool.
5. **Emit** verdict + keep + findings only.

Empty own findings OK. Handoff may say "none". Still run both helpers.

Skip `reasoning_coach` only when the diff has no behavior, persistence, contract, or policy change (docs/comments/changelog only). Still run `patch_reviewer`.

### Scope of input

- **GitHub PR:** `gh pr view`, `gh pr diff`, checks as needed. Prefer PR number/URL from user.
- **Local / no PR:** user-pointed branch, staged, or unstaged diff. Same protocol.

Do not open GitHub review API or submit review unless user ask to post.
Do not implement fixes unless user ask.
Do not expand into QA strategy or test-plan authoring.

### Own pass

1. Load metadata (title, body, base/head, CI if cheap).
2. Diff stat + full diff for changed paths.
3. Read surrounding code only where diff alone cannot decide correctness.
4. List material decisions: policy, persistence, contracts, failure handling, enablement, anything the happy path hides.
5. Note findings with `path:line` (or region) and severity.
6. Build both handoff packets.

### Handoff packet (required before `patch_reviewer`)

Pass as the tool `task` (and paths when useful):

- PR URL/number **or** local scope (branch, staged, unstaged, path list)
- Diff stat + changed paths
- Own findings with `file:line` **or** explicit `none`
- 2-3 focused questions for the reviewer helper

Example task shape:

```text
PR: https://github.com/org/repo/pull/123
Stat: N files, +X/-Y
Paths: a/b.ts, c/d.ts
Own findings: none
Questions:
1. Does the retry path double-write under concurrent callers?
2. Is the new schema backward-compatible with in-flight readers?
```

### Handoff packet (required before `reasoning_coach`)

Production-grade pass. Helper does not load this skill; the `task` must carry the bar. Review the diff against the bar; do not restate the bar.

Pass as the tool `task` (and paths when useful):

- PR URL/number **or** local scope
- Diff stat + changed paths
- Material decisions in the change
- Own findings with `file:line` **or** explicit `none`
- Stance + bar + grade set (copy from this skill). Shortcut patterns only as lens, not a mandatory checklist.
- The five questions below, always. Add at most two diff-specific questions after, never instead.

Required questions:

1. What does this change rely on when X goes wrong? Named and enforceable, or implied by control flow? How do we know it broke vs worked?
2. One model end-to-end, or only the path that was tested?
3. Can this be enabled, rolled back, or retried on existing data, or does it assume greenfield? Ask only when the change touches persisted or externally visible state.
4. Where does this change encode a faster way, and what right way is it borrowing against?
5. Can the next person (or you in six months) find, understand, change, and verify this with small blast radius? If not, name the coupling, hidden rationale, or unverifiable path. "Would not keep" without that name is not a finding.

Example task shape:

```text
PR: https://github.com/org/repo/pull/123
Stat: N files, +X/-Y
Paths: a/b.ts, c/d.ts
Decisions:
1. ...
2. ...
Own findings: none
Stance: right way, not done-way. A passing happy path is not the bar. Review the diff against the bar; do not restate the bar.
Bar: invariants named and enforceable; failure named (what happens when X goes wrong, how we know broke vs worked); one model end-to-end; enable/rollback/retry on existing data; fast path must not redefine policy; next reader can find/change/verify with small blast radius; greenfield re-run is not migration evidence.
Grade each decision: production-grade (keep) | sound shape; weak implementation | not professional | defect.
For each non-keep: name faster way vs right way. Keep sound foundations; harden, do not revert.
Questions:
1. What does this change rely on when X goes wrong? Named and enforceable, or implied by control flow? How do we know it broke vs worked?
2. One model end-to-end, or only the path that was tested?
3. Can this be enabled, rolled back, or retried on existing data, or does it assume greenfield?
4. Where does this change encode a faster way, and what right way is it borrowing against?
5. Can the next person (or you in six months) find, understand, change, and verify this with small blast radius? If not, name the coupling, hidden rationale, or unverifiable path. A no is not a finding by itself.
```

Coach must return: grade per decision, keep list, not-production-grade list with faster vs right, and one right-way shape (single end-to-end story).

### Merge protocol

- Dedupe by `(file, line/region, behavior)`.
- Collision: keep **max** severity. Never downgrade a confirmed finding.
- Helper-only finding: spot-check against actual code once before report.
- One list. One voice. No "own pass said / tool said".
- Map coach grades after the spot-check:
  - defect → **high**, or **blocker** if silent data loss / irreversible wrong persist
  - not professional → **high** if unsafe enable, silent freeze, or split identity; else **medium**
  - sound shape; weak implementation → **medium**, or **high** if merge ships fake-success or non-atomic claim
  - production-grade (keep) → Keep list, not a finding
- Q5 (find / understand / change / verify) is not a finding by itself. Map only when a named coupling, hidden rationale, or unverifiable path fails a grade above.

### Ban list (hard)

- **Test gaps / coverage wishlists** never findings. Exception: test asserts something **false** about shipped behavior, or locks in a bug. That is a correctness finding.
- **No praise.** No "what works", "overall solid", compliments in verdict.
- Keep list is not praise. It stops the author from ripping out the right architecture.
- No vibe veto. "Would not keep" or "hard to read" without a named coupling, hidden rationale, or unverifiable path is not a finding.
- Style, naming preference, extra comments, and whitespace are not findings. Exception: a name or comment that states something **false** about shipped behavior.
- No filler, no tool-call narration, no recap of the three passes.

### Severity

| Level   | Use when                                                                         |
| ------- | -------------------------------------------------------------------------------- |
| blocker | Silent data loss, irreversible wrong persist/acquire, security, known corruption |
| high    | Clear correctness bug; recoverable later but wrong if merged                     |
| medium  | Real risk under plausible conditions (races, rate limits, contract drift)        |
| low     | Docs drift, changelog inaccuracy, minor inconsistency                            |

### Verdict

One of: `merge-ready` | `request changes` | `not merge-ready`

- Any **blocker** or **high** means `request changes` (fixable in-branch) or `not merge-ready`
- Sort findings: blocker, high, medium, low
- Each finding: location `path:line`, impact one line, fix one line, grade when it came from the production-grade pass
- If any decision is not keep: short **Right-way** block, one end-to-end story
- End with **one** concrete next action

### Output shape

```text
Verdict: request changes

Keep:
- per-source identity policy

Right-way:
- identity = f(stable key); failures use identity; skip != fetch success; enable implies backfill first

Findings:
- [high] path/file.ts:42
  impact: ...
  fix: ...
  grade: not professional

Next: ...
```

If zero findings after merge:

```text
Verdict: merge-ready
Keep:
- ...
Findings: none
Next: ...
```

Omit Keep when empty. Omit Right-way when every material decision is keep.
