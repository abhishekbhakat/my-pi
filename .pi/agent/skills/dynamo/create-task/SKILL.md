---
name: dynamo-create-task
description: "Author a Terminal-Bench 2 (TB2) task for Project Dynamo end-to-end. Use when starting or working on a task repo: writing the proposal, forking/scaffolding, authoring solution/solve.sh, writing tests, building the environment Dockerfile, writing instruction.md, filling task.toml, or validating locally with Harbor before opening a PR. Covers the task/ file structure and workflow steps 1-7."
---

Build a Terminal-Bench 2 (TB2) task for Project Dynamo. You write one task repo; the
benchmark then scores any agent that attempts it. Pay is an hourly base plus a bonus
when the task reaches Ready-to-Deliver (RTD). Most rejections come from weak tests or
a weak instruction.md, so follow the checklist exactly.

Full page text is in `reference/` (01-introduction.md … 12-workflow-videos.md).

## The five components you author

| File | What it is |
|------|------------|
| `instruction.md` | The ONLY thing the agent sees at runtime. States the problem, pins absolute `/app/...` paths, lists success criteria. Cap: 1,500 tokens. Ends with the timeout line. |
| `solution/solve.sh` | Golden reference (Oracle) solution. Real logic lives in a helper (e.g. `solve.py`) that `solve.sh` calls. Never copied into the agent image. |
| `tests/test.sh` + `tests/test_outputs.py` | Verifier (pytest). Runs AFTER the agent finishes; writes reward to `/logs/verifier/reward.txt`. `tests/` is mounted only at verify time, never present during the agent run. |
| `environment/Dockerfile` | The task's single image, built once and reused for both the agent run and the verifier run. Never contains solution or tests. |
| `task.toml` | Machine-readable manifest: identity, environment limits, verifier mode, metadata. |

The agent works in `/app` with only `instruction.md` and seed files. Two scoring rules:

1. Keep the golden solution and tests out of the agent image, or the task is invalid.
2. Score only observable artifacts: files on disk, exit codes. Nothing that lives in
   stdout counts.

## Workflow

1. **Claim a task.** On the annotation platform, pick a Category/Sub-category you can
   deliver on and write both down. The proposal asks for them later. Accept the repo
   invite. Hold one claim at a time; release the task if it is not a fit.
2. **Write the proposal.** An automated reviewer passes or fails it; revise until it
   passes before building anything. Four required answers:
   - Difficulty. Why is it hard for an expert? Name the reasoning, domain knowledge,
     or multi-step work involved, who does this work in the real world, and where the
     data comes from.
   - Intended approach. High-level strategy, key insight, best-case expert-time
     estimate in hours. This proves you hold a solution.
   - Verification. What output must the agent produce, and how does a program check it
     deterministically? Justify any tolerance band.
   - Category justification. Why does the task fit your chosen Category/Sub-category?
     Do not edit the pre-filled Category/Sub-category fields.
   - Common rejection causes: vague difficulty, no key insight, unjustified tolerances,
     no expert-time estimate, a task solvable by reasoning alone, a textbook problem,
     grading that depends on method.
3. **Fork and scaffold.**
   ```bash
   gh repo fork handshake-project-dynamo/<your-task-repo> --clone
   cd <your-task-repo>/task
   git checkout -b submission
   ```
   The task lives in `task/`, not the repo root. Layout: `task.toml`, `instruction.md`,
   `solution/solve.sh`, `environment/Dockerfile`, `tests/{test.sh,test_outputs.py}`,
   `environment/data/` for optional inputs. The folders `.dynamo/`, `.github/`, and
   `.harbor/` are provided; do not edit them. Replace `README.md` with a short task
   description before the final submit.
4. **Author `solution/solve.sh`.** This reference solution proves the task is solvable.
   Rules:
   - No package installs inside solve.sh; the Dockerfile handles all setup.
   - Write outputs to the absolute `/app/...` paths named in instruction.md.
   - Put non-trivial logic in helper files.
   - Reward is binary 1/0 by default. Fractional partial credit is allowed only when
     the task declares it in instruction.md AND test.sh emits the matching scheme.
   ```bash
   harbor run -p . --agent oracle   # expect: reward 1.0
   ```
   Then write a numbered list of observable success criteria from what the solution
   produced: file existence, schema, ordering, arithmetic relationships. That list
   drives the tests (step 5) and becomes the instruction spec (step 7).
5. **Write the tests.** The verifier runs in a fresh container from the single image;
   Harbor mounts `tests/` at verify time. The verifier can read only the agent's
   outputs at `/app/...`, anything baked into the image, and sidecars from
   `environment/docker-compose.yaml`. Ground-truth data lives in `tests/`, NEVER in
   `environment/`, where the agent could read it.
   - `test.sh` runs pytest and writes the reward. It installs and downloads nothing;
     bake dependencies into the Dockerfile instead. It always writes the reward and
     always exits 0. Default scoring is binary 1/0; partial credit only when
     instruction.md declares it and test.sh matches it (mismatch = QC check C6).
     ```bash
     #!/bin/bash
     pytest --ctrf /logs/verifier/ctrf.json /tests/test_outputs.py -rA
     if [ $? -eq 0 ]; then echo 1 > /logs/verifier/reward.txt
     else echo 0 > /logs/verifier/reward.txt; fi
     ```
   - `test_outputs.py` has one test function per success criterion, each with a
     docstring, asserting on observable `/app` artifacts. Check real outputs; do not
     string-match source or reference solve.sh.
   - Calibrate both directions:
     ```bash
     harbor run -p . --agent oracle   # expect: reward 1.0
     harbor run -p . --agent nop      # expect: reward < 1.0
     ```
   - Determinism: fixed seeds and inputs, no unseeded randomness, no wall-clock or
     date dependence. Do not ship a reward.txt in the environment.
6. **Build `environment/Dockerfile`.** One image serves both the agent run and the
   verifier run.
   - Use a base image from the allowlist below, pinned by digest `@sha256:...`. No
     `:latest`, no bare tags. Only use a non-allowlisted image when none of these can
     support the task's dependencies, and document why. Allowlist (pin by these
     digests):
     - Go 1.21-1.26: `public.ecr.aws/docker/library/golang:1.24-bookworm@sha256:1a6d4452c65dea36aac2e2d606b01b4a029ec90cc1ae53890540ce6173ea77ac`
     - Python 3.10-3.13: `public.ecr.aws/docker/library/python:3.13-slim-bookworm@sha256:01f42367a0a94ad4bc17111776fd66e3500c1d87c15bbd6055b7371d39c124fb`
     - Debian: `public.ecr.aws/docker/library/debian:bookworm-slim@sha256:4724b8cc51e33e398f0e2e15e18d5ec2851ff0c2280647e1310bc1642182655d`
     - Rust 1.75-1.95: `public.ecr.aws/docker/library/rust:1.85-slim@sha256:9f841bbe9e7d8e37ceb96ed907265a3a0df7f44e3737d0b100e7907a679acb36`
     - Node 18/20/22/24: `public.ecr.aws/docker/library/node:22-bookworm-slim@sha256:f3a68cf41a855d227d1b0ab832bed9749469ef38cf4f58182fb8c893bc462383`
     - Ubuntu 22.04/24.04: `public.ecr.aws/docker/library/ubuntu:24.04@sha256:0d39fcc8335d6d74d5502f6df2d30119ff4790ebbb60b364818d5112d9e3e932`
     - Java 17/21: `public.ecr.aws/docker/library/eclipse-temurin:21-jdk-jammy@sha256:25d1276565738d3c805e632a4542c3a7598866ef967f4def6544c15de3a74b14`
     - Ruby 3.2-3.4: `public.ecr.aws/docker/library/ruby:3.3-slim-bookworm@sha256:e76733e94b3a5893e4a141024ef3a583dc10781dc24becebf74f9c9f9a33e3df`
     - Maven: `public.ecr.aws/docker/library/maven:3.9.9-eclipse-temurin-21@sha256:3a4ab3276a087bf276f79cae96b1af04f53731bec53fb2e651aca79e4b10211e`
     - GCC 12-15: `public.ecr.aws/docker/library/gcc:13-bookworm@sha256:930f2ebe239275fa67226654cb79273ea34eee672ae61c8a39f689c37fb7ac5c`
     - Other versions in the same family are allowed, but pin that image's own digest.
   - Rules: pin pip/npm to exact versions; do NOT pin apt packages. Never `COPY
     solution/` or `tests/`. Put input data in `environment/data/` and COPY it to
     `/app/...`. Bake all pinned test dependencies (pytest, pytest-json-ctrf) into
     this image. Use a multi-stage build for compiled artifacts. Add a
     `.dockerignore`. No heredocs; extract tarballs at build time. chmod only the
     specific files that need it. `RUN mkdir -p` the parent dir of EVERY output path
     the agent writes, or artifact upload fails.
   - After every build, confirm the image is clean:
     ```bash
     docker run --rm <repo-name>:dev /bin/bash -lc \
       'find / \( -name solve.sh -o -name test.sh \) 2>/dev/null'   # expect: no output
     ```
7. **Write `instruction.md` and `task.toml`.**
   - instruction.md: prompt-style, no title, no headers, no roleplay. Write it
     yourself as a domain expert (no LLM-generated text). Use absolute paths. Name
     every output file and its exact format. Do not reveal the solution. Stay under
     1,500 tokens. End with exactly:
     `You have N seconds to complete this task. Do not cheat by using online solutions or hints specific to this task.`
     where N = `[agent].timeout_sec` in task.toml. A static check fails the PR if they
     disagree, so update both together.
   - task.toml key fields (full schema: reference/010-workflow-step-7.md):
     - `artifacts = []`: output paths the verifier reads, above the first `[section]`.
     - `[task] name = "dynamo/your-task-name"` (lowercase kebab-case, ≤3 words) and a
       one-line `description`.
     - `[metadata]`: `category` and `subcategory` are PRE-SEEDED; do not edit.
       `model_tested = "GPT-5.4"` and `agent_tested = "Terminus-2"` are fixed; leave
       as-is. You fill `task_objective` and `artifact_type` (lowercase snake_case
       labels from `.dynamo/diversity-taxonomy.toml`),
       `expert_time_estimate_hours`, `difficulty_explanation`,
       `solution_explanation`, `verification_explanation`. Carry these over from your
       proposal. No author info anywhere in task.toml.
     - `[verifier] timeout_sec`; `[agent] timeout_sec` (must match the instruction.md
       line and stay ≤ 3600); `[environment] build_timeout_sec`, `cpus`, `memory_mb`,
       `storage_mb`, `gpus` (max 1 H100), `allow_internet = true` by default,
       `mcp_servers = []`.
     - Leave `[verifier] environment_mode` unset. Harbor runs the verifier in the
       environment image and overlays tests/ at verify time.

## Validate locally before opening the PR

The PR reviewer reads files but never builds or runs them. Prove the task works
yourself.

```bash
harbor run -p . --agent oracle   # must be reward 1.0
harbor run -p . --agent nop      # must be reward < 1.0
docker run --rm <repo-name>:dev /bin/bash -lc \
  'find / \( -name solve.sh -o -name test.sh \) 2>/dev/null'   # no output
```

Re-run oracle and nop twice from a clean checkout. Results must be identical; if they
vary, fix seeds and inputs. Then self-review with the reviewer judgment areas (see
the dynamo-review skill): the pieces gel together, the task is solvable as packaged,
hard for an expert, realistic, novel, unambiguous, the verifier is robust, tests
grade exactly what the instruction states, and the solution computes its answer
rather than hardcoding it.

## PR description template (use this exact shape)

```markdown
## One-sentence problem
The task is done when ___.

## Success criteria (numbered, mirror instruction.md)
1. ...
2. ...

## Calibration results
- Golden solve.sh: reward 1.0
- Bad / nop solution: reward < 1.0

## How to run
harbor run -p . --agent oracle   # reward 1.0
harbor run -p . --agent nop      # reward < 1.0

## Notes / open questions
Anything in instruction.md you had to interpret.
```

AI tool policy: write instruction.md and the solution by hand. Dockerfiles and test
boilerplate may come from coding assistants, but verify them before submission.

Source: https://project-dynamo.learn.joinhandshake.com/ (captured 2026-07-08).
