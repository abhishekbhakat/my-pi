---
name: coding
description: >-
  Write quality code readable by humans and AI agents, keep agent context lean
  and correct, and review PRs with a fixed protocol. Use when writing or
  refactoring code, designing or trimming AGENTS.md/CLAUDE.md, diagnosing
  repeated agent mistakes, cutting context bloat, or when user ask PR review,
  review pull request, merge readiness, review PR #N, or equivalent.
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

## Intervention ladder (agent keeps doing wrong thing)

Apply top first. Move down only when the level above cannot kill the problem.

1. **Architecture / data structures** — make the failure impossible. Typed contracts across boundaries, one shared data layer across surfaces, adapter boundary holds complexity, orchestration and UI stay dumb.
2. **Lint / CI / tests** — agent sees the failure before reporting done. Gate real numbers (payload bytes, bundle size, query count) with a ceiling slightly above current baseline.
3. **Skill / short rule** — mostly for process around the code (remote access, release steps), not core domain logic.
4. **Human in the loop** — last resort. Reached often means levels 1-2 are under-built.

Adding a rule without trying levels 1-2 first is a smell.

## Anti-patterns

| Anti-pattern | Why it fails |
| ------------ | ------------ |
| Auto-saved agent memory of PRs, specs, one-off debug | Writes far outnumber reads; stale state steers future runs wrong |
| Long-lived plan/design markdown in repo | Decays faster than code; becomes wrong instructions |
| Comments explaining past workarounds | Rot; comments must move with code or die |
| Embeddings/RAG/code-graph retrieval as default | Models with bash and search navigate code well; unproven lift, real cost. Adopt retrieval only with an eval showing better output |
| Skill or MCP server per integration | Skills are the fallback after architecture and CI; MCP tends to dump bulk into context. Prefer a small script that writes files |

## Context hygiene

Belongs in durable repo context (AGENTS.md and friends):

- What the product is and what "good" means (open, performance, remote, surfaces)
- Shared glossary; kill invented jargon
- Hard process facts the agent cannot infer (long-lived dev servers, PR title rules)
- Taste rules that change defaults (where complexity lives, inferred types, comments describe use and move with code)
- Short folder map only when repo is huge and the map stays maintained

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

## PR review

Two-pass review. Problems only. Repo-agnostic.

### Hard order (normative)

1. **Own pass first.** Read PR metadata, diff, changed paths, needed surrounding code. Run focused checks only to verify a suspected issue.
2. **Do not** launch `patch_reviewer` before own pass finishes.
3. **After own pass:** launch `patch_reviewer` with handoff packet below.
4. **Merge** own findings + patch_reviewer. Single voice. Never attribute to the tool.
5. **Emit** verdict + findings only.

Empty own findings OK. Handoff may say "none" — still run `patch_reviewer`.

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
4. Note findings with `path:line` (or region) and severity.
5. Build handoff packet.

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

### Merge protocol

- Dedupe by `(file, line/region, behavior)`.
- Collision: keep **max** severity. Never downgrade a confirmed finding.
- Reviewer-only finding: spot-check against actual code once before report.
- One list. One voice. No "own pass said / tool said".

### Ban list (hard)

- **Test gaps / coverage wishlists** — never findings. Exception: test asserts something **false** about shipped behavior, or locks in a bug. That is a correctness finding.
- **No praise.** No "what works", "overall solid", compliments in verdict.
- No filler, no tool-call narration, no dual recap of both passes.

### Severity

| Level   | Use when                                                                          |
| ------- | --------------------------------------------------------------------------------- |
| blocker | Silent data loss, irreversible wrong persist/acquire, security, known corruption  |
| high    | Clear correctness bug; recoverable later but wrong if merged                      |
| medium  | Real risk under plausible conditions (races, rate limits, contract drift)         |
| low     | Docs drift, changelog inaccuracy, minor inconsistency                             |

### Verdict

One of: `merge-ready` | `request changes` | `not merge-ready`

- Any **blocker** or **high** means `request changes` (fixable in-branch) or `not merge-ready`
- Sort findings: blocker, high, medium, low
- Each finding: location `path:line`, impact one line, fix one line
- End with **one** concrete next action

### Output shape

```text
Verdict: request changes

Findings:
- [high] path/file.ts:42
  impact: ...
  fix: ...

Next: ...
```

If zero findings after merge:

```text
Verdict: merge-ready
Findings: none
Next: ...
```
