---
name: dynamo-setup
description: "Install and configure Project Dynamo / Terminal-Bench 2 (TB2) tooling: Docker, uv, Harbor CLI, GitHub CLI, and fork/clone of the assigned task repo. Use before starting a first task, when Harbor commands fail, or when setting up a new machine for benchmark task authoring."
---

Set up a machine for Project Dynamo task authoring. Full page text: `reference/03-setup.md`.

## 1. Install prerequisites

1. Docker, installed and running
2. uv: https://astral.sh/uv
3. Python 3.11+
4. GitHub CLI: https://cli.github.com/, then `gh auth login`

## 2. Install Harbor

```bash
uv tool install harbor
harbor --version
```

## 3. Fork your assigned task repo

Your assigned repo lives under `handshake-project-dynamo`. You have no write access
to the base repo, so you propose changes by pull request.

```bash
gh repo fork handshake-project-dynamo/<your-task-repo> --clone
cd <your-task-repo>/task
git checkout -b submission
```

The scaffold sits in `task/` with `task.toml`, `instruction.md`, `solution/solve.sh`,
`environment/Dockerfile`, and `tests/{test.sh,test_outputs.py}`. The folders
`.dynamo/`, `.github/`, and `.harbor/` are provided; do not edit them. Optional input
files go in `environment/data/`.

## Core Harbor commands (run from `task/`)

```bash
harbor run -p . --agent oracle   # run your solution against the verifier → expect reward 1.0
harbor run -p . --agent nop      # no-op agent must score reward < 1.0
```

No model API key is needed to scaffold, run the oracle, or calibrate locally. Run
these only AFTER authoring solve.sh, the tests, and the Dockerfile (dynamo-create-task
skill, steps 4-6).

Source: https://project-dynamo.learn.joinhandshake.com/setup (captured 2026-07-08).
