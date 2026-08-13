---
name: dynamo-create-task
description: "Author Terminal-Bench 2 (TB2) task for Project Dynamo end-to-end. Use when start or work on task repo: write proposal, fork/scaffold, author solution/solve.sh, write tests, build environment Dockerfile, write instruction.md, fill task.toml, or validate local with Harbor before open PR. Cover task/ file structure and workflow steps 1-7."
---

Build Terminal-Bench 2 (TB2) task for Project Dynamo. You write one task repo; benchmark then score any agent that attempt it. Pay is hourly base plus bonus when task reach Ready-to-Deliver (RTD). Most rejections come from weak tests or weak instruction.md, so follow checklist exact.

Full page text is in `reference/` (01-introduction.md … 12-workflow-videos.md).

## Five components you author

| File | What it is |
|------|------------|
| `instruction.md` | ONLY thing agent see at runtime. State problem, pin absolute `/app/...` paths, list success criteria. Cap: 1,500 tokens. End with timeout line. |
| `solution/solve.sh` | Golden reference (Oracle) solution. Real logic live in helper (e.g. `solve.py`) that `solve.sh` call. Never copied into agent image. |
| `tests/test.sh` + `tests/test_outputs.py` | Verifier (pytest). Run AFTER agent finish; write reward to `/logs/verifier/reward.txt`. `tests/` mounted only at verify time, never present during agent run. |
| `environment/Dockerfile` | Task single image, built once and reused for both agent run and verifier run. Never contain solution or tests. |
| `task.toml` | Machine-readable manifest: identity, environment limits, verifier mode, metadata. |

Agent work in `/app` with only `instruction.md` and seed files. Two scoring rules:

1. Keep golden solution and tests out of agent image, or task is invalid.
2. Score only observable artifacts: files on disk, exit codes. Nothing that live in stdout count.

## Workflow

1. **Claim task.** On annotation platform, pick Category/Sub-category you deliver on and write both down. Proposal ask for them later. Accept repo invite. Hold one claim at a time; release task if it is not a fit.
2. **Write proposal.** Automated reviewer pass or fail it; revise until it pass before build anything. Four required answers:
   - Difficulty. Why is it hard for expert? Name reasoning, domain knowledge, or multi-step work involved, who do this work in real world, and where data come from.
   - Intended approach. High-level strategy, key insight, best-case expert-time estimate in hours. This prove you hold solution.
   - Verification. What output must agent produce, and how does program check it deterministic? Justify any tolerance band.
   - Category justification. Why does task fit chosen Category/Sub-category? Do not edit pre-filled Category/Sub-category fields.
   - Common rejection causes: vague difficulty, no key insight, unjustified tolerances, no expert-time estimate, task solvable by reasoning alone, textbook problem, grading that depend on method.
3. **Fork and scaffold.**
   ```bash
   gh repo fork handshake-project-dynamo/<your-task-repo> --clone
   cd <your-task-repo>/task
   git checkout -b submission
   ```
   Task live in `task/`, not repo root. Layout: `task.toml`, `instruction.md`,
   `solution/solve.sh`, `environment/Dockerfile`, `tests/{test.sh,test_outputs.py}`,
   `environment/data/` for optional inputs. Folders `.dynamo/`, `.github/`, and
   `.harbor/` are provided; do not edit them. Replace `README.md` with short task
   description before final submit.
4. **Author `solution/solve.sh`.** This reference solution prove task is solvable.
   Rules:
   - No package installs inside solve.sh; Dockerfile handle all setup.
   - Write outputs to absolute `/app/...` paths named in instruction.md.
   - Put non-trivial logic in helper files.
   - Reward is binary 1/0 by default. Fractional partial credit allowed only when
     task declare it in instruction.md AND test.sh emit matching scheme.
   ```bash
   harbor run -p . --agent oracle   # expect: reward 1.0
   ```
   Then write numbered list of observable success criteria from what solution
   produce: file existence, schema, ordering, arithmetic relationships. That list
   drive tests (step 5) and become instruction spec (step 7).
5. **Write tests.** Verifier run in fresh container from single image;
   Harbor mount `tests/` at verify time. Verifier can read only agent
   outputs at `/app/...`, anything baked into image, and sidecars from
   `environment/docker-compose.yaml`. Ground-truth data live in `tests/`, NEVER in
   `environment/`, where agent could read it.
   - `test.sh` run pytest and write reward. It install and download nothing;
     bake dependencies into Dockerfile instead. It always write reward and
     always exit 0. Default scoring is binary 1/0; partial credit only when
     instruction.md declare it and test.sh match it (mismatch = QC check C6).
     ```bash
     #!/bin/bash
     pytest --ctrf /logs/verifier/ctrf.json /tests/test_outputs.py -rA
     if [ $? -eq 0 ]; then echo 1 > /logs/verifier/reward.txt
     else echo 0 > /logs/verifier/reward.txt; fi
     ```
   - `test_outputs.py` have one test function per success criterion, each with
     docstring, assert on observable `/app` artifacts. Check real outputs; do not
     string-match source or reference solve.sh.
   - Calibrate both directions:
     ```bash
     harbor run -p . --agent oracle   # expect: reward 1.0
     harbor run -p . --agent nop      # expect: reward < 1.0
     ```
   - Determinism: fixed seeds and inputs, no unseeded randomness, no wall-clock or
     date dependence. Do not ship reward.txt in environment.
6. **Build `environment/Dockerfile`.** One image serve both agent run and
   verifier run.
   - Use base image from allowlist below, pinned by digest `@sha256:...`. No
     `:latest`, no bare tags. Only use non-allowlisted image when none of these can
     support task dependencies, and document why. Allowlist (pin by these
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
     - Other versions in same family allowed, but pin that image own digest.
   - Rules: pin pip/npm to exact versions; do NOT pin apt packages. Never `COPY
     solution/` or `tests/`. Put input data in `environment/data/` and COPY it to
     `/app/...`. Bake all pinned test dependencies (pytest, pytest-json-ctrf) into
     this image. Use multi-stage build for compiled artifacts. Add
     `.dockerignore`. No heredocs; extract tarballs at build time. chmod only
     specific files that need it. `RUN mkdir -p` parent dir of EVERY output path
     agent write, or artifact upload fail.
   - After every build, confirm image is clean:
     ```bash
     docker run --rm <repo-name>:dev /bin/bash -lc \
       'find / \( -name solve.sh -o -name test.sh \) 2>/dev/null'   # expect: no output
     ```
7. **Write `instruction.md` and `task.toml`.**
   - instruction.md: prompt-style, no title, no headers, no roleplay. Write it
     yourself as domain expert (no LLM-generated text). Use absolute paths. Name
     every output file and its exact format. Do not reveal solution. Stay under
     1,500 tokens. End with exactly:
     `You have N seconds to complete this task. Do not cheat by using online solutions or hints specific to this task.`
     where N = `[agent].timeout_sec` in task.toml. Static check fail PR if they
     disagree, so update both together.
   - task.toml key fields (full schema: reference/010-workflow-step-7.md):
     - `artifacts = []`: output paths verifier read, above first `[section]`.
     - `[task] name = "dynamo/your-task-name"` (lowercase kebab-case, ≤3 words) and
       one-line `description`.
     - `[metadata]`: `category` and `subcategory` are PRE-SEEDED; do not edit.
       `model_tested = "GPT-5.4"` and `agent_tested = "Terminus-2"` are fixed; leave
       as-is. You fill `task_objective` and `artifact_type` (lowercase snake_case
       labels from `.dynamo/diversity-taxonomy.toml`),
       `expert_time_estimate_hours`, `difficulty_explanation`,
       `solution_explanation`, `verification_explanation`. Carry these over from
       proposal. No author info anywhere in task.toml.
     - `[verifier] timeout_sec`; `[agent] timeout_sec` (must match instruction.md
       line and stay ≤ 3600); `[environment] build_timeout_sec`, `cpus`, `memory_mb`,
       `storage_mb`, `gpus` (max 1 H100), `allow_internet = true` by default,
       `mcp_servers = []`.
     - Leave `[verifier] environment_mode` unset. Harbor run verifier in
       environment image and overlay tests/ at verify time.

## Validate local before open PR

PR reviewer read files but never build or run them. Prove task work yourself.

```bash
harbor run -p . --agent oracle   # must be reward 1.0
harbor run -p . --agent nop      # must be reward < 1.0
docker run --rm <repo-name>:dev /bin/bash -lc \
  'find / \( -name solve.sh -o -name test.sh \) 2>/dev/null'   # no output
```

Re-run oracle and nop twice from clean checkout. Results must be identical; if they
vary, fix seeds and inputs. Then self-review with reviewer judgment areas (see
dynamo-review skill): pieces gel together, task is solvable as packaged,
hard for expert, realistic, novel, unambiguous, verifier is robust, tests
grade exactly what instruction state, and solution compute its answer
rather than hardcode it.

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

AI tool policy: write instruction.md and solution by hand. Dockerfiles and test
boilerplate may come from coding assistants, but verify them before submission.

Source: https://project-dynamo.learn.joinhandshake.com/ (captured 2026-07-08).
