---
name: create-adapter
description: Scaffold new Harbor benchmark adapter by run `harbor adapter init` and then guide implementation using Adapters Agent Guide as authoritative spec.
---

# Create Adapter

Bootstrap new benchmark adapter in Harbor repository. This skill scaffold adapter directory with `harbor adapter init` and then defer to adapter tutorial for every implementation decision.

## Authoritative reference

Adapter tutorial is authoritative specification for this skill. Read it in full before take any action beyond scaffolding:

```
docs/content/docs/datasets/adapters.mdx
```

That path is relative to Harbor repo root (skill prerequisite — see below). Tutorial contain:

- Required directory structures for generated tasks and adapter code package.
- Step-by-step process (steps 1-9) cover benchmark analysis, oracle verification, parity experiments, dataset registration, and submission.
- Schemas for `task.toml`, `parity_experiment.json`, `adapter_metadata.json`, and `dataset.toml`.
- Parity matching criterion, pre-flight checklist, and debug playbook.
- README format rules (machine-parsed; deviations break automation).

Do not substitute prior knowledge for contents of that file. Treat it as contract.

## Prerequisites

- Harbor CLI is installed and available on `PATH` (`harbor --version` succeed).
- Working directory is Harbor repository root.
- Harbor checkout is current: run `git fetch origin && git status` and pull `main` if behind. Stale checkouts miss recent adapter and agent fixes and are common source of spurious parity failures later on.

## Workflow

### 1. Read tutorial

Before any filesystem or CLI action, Read `docs/content/docs/datasets/adapters.mdx` in full. Pay particular attention to:

- **Required Directory Structures** — contract for generated task and adapter layouts.
- **Step 1. Understand the Original Benchmark** — what to identify upstream before coding.
- **Step 8. Register the Dataset → Naming rules** — `name` field and `<org>/<task>` format requirements.

### 2. Gather benchmark context from user

Collect following before scaffolding. If user have not provided item, ask before proceed — these inputs shape scaffold and tutorial steps that follow.

| Field | Why it matter |
|-------|---------------|
| Adapter name | Lowercase, hyphen-separated. Must match benchmark common identifier (e.g., `swe-bench`, `aider-polyglot`). Become directory under `adapters/` and, after underscore conversion, Python package name. |
| Human-readable name | Passed via `--name`; appear in generated README. |
| Upstream repo URL | Needed for tutorial Step 1 (benchmark analysis) and for `original_parity_repo` field later. |
| Oracle solutions available? | If benchmark ship reference solutions, use them. If not, oracle solutions must be LLM-generated (tutorial Step 3, "Benchmarks without oracle solutions"). |
| Agent scenario | Which of Step 4 scenarios apply: (1) existing compatible agent, (2) fork + add LLM agent, or (3) custom agent. This shape parity plan. |

### 3. Create adapter branch

Per tutorial Step 2, work on dedicated branch:

```bash
git checkout -b <adapter-name>-adapter
```

### 4. Run scaffold

Prefer non-interactive form when both names are known:

```bash
harbor adapter init <adapter-name> --name "<Human-Readable Name>"
```

Otherwise run `harbor adapter init` interactive and let CLI prompt.

Expected output: new directory at `adapters/<adapter-name>/` contain `pyproject.toml`, `README.md`, `src/<adapter_name>/`, and template task files under `src/<adapter_name>/task-template/`. Verify directory exist before continue.

### 5. Hand off to tutorial

Continue from "Step 1. Understand the Original Benchmark" in tutorial. Do not invent structure, field names, or workflow beyond what guide specify.

**High-priority gotchas** (each is documented in tutorial, but these are most common adapter-build failures — surface them proactive as you work through steps):

- **Every generated `task.toml` must contain `name` field under `[task]`.** `main.py` is responsible for derive sanitized, unique, registry-safe name for every task. Tasks without `name` cannot be registered. See tutorial "Naming rules" table.
- **Task names must be stable across adapter runs.** Unstable names churn registry digests on republish. If upstream lack stable identifiers, mint deterministic scheme (e.g., `{dataset}-1`, `{dataset}-2`) from reproducible sort.
- **Use `schema_version = "1.4"` at top of `task.toml`.** Set package versions separate with `[task].version` in `task.toml` and `[dataset].version` in `dataset.toml`. Request any desired registry tags in PR description.
- **`main.py` must support `--output-dir`, `--limit`, `--overwrite`, and `--task-ids`.** These flags are required for reproducible runs and task-level debugging.
- **Generated `README.md` is parsed by downstream automation.** Fill in every section exactly as template define; put extra context in **Notes** section or in `notes` fields of `parity_experiment.json` / `adapter_metadata.json`. Do not add, rename, reorder, or remove sections.
- **Do not run parity experiments unilateral.** Tutorial Step 4 require team coordination on agents, models, and number of runs before incur API costs. Complete sanity checks first, and execute full runs symmetric on both sides.

## Reference adapters by scenario

When implementation questions come up, point at existing adapter that match benchmark shape:

| Scenario | Example adapter | When to use |
|----------|----------------|-------------|
| Compatible agent already exist | `adapters/adebench/` | Upstream already support Claude-Code / Codex / OpenHands / Gemini-CLI |
| Fork upstream + add LLM agent | `adapters/evoeval/` | LLM-based benchmark with no Harbor-compatible agent |
| Custom agent, separate dataset | `adapters/bixbench/`, `adapters/financeagent/` | Custom interaction semantics; financeagent also demo LLM-as-a-Judge |
| Custom agent in-place | `adapters/medagentbench/` | Custom HTTPAgent, no separate dataset |
| Multi-agent workflow | `adapters/cooperbench/` | Multiple agents coordinate via messaging / sidecars |
| GPU tasks | `adapters/featurebench/` | Comprehensive Docker + Modal GPU example |

## What this skill do NOT do

- Implement `adapter.py`, `main.py`, or any task-template files. Those are contributor work, guided by tutorial.
- Run oracle verification or parity experiments. Those require explicit user intent and, for parity, team coordination.
- Publish dataset or open PRs. Those are later steps in tutorial.

## Failure modes

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| `harbor: command not found` | Harbor CLI not installed | Install with `uv tool install harbor` or repository development setup. |
| `harbor adapter init` fail with name validation error | Adapter name contain invalid characters | Re-run with lowercase, hyphen-separated name. |
| Scaffold succeed but `adapters/<name>/` is not present | Running from outside repository root | `cd` to Harbor repository root and re-run. |
| Oracle pass local but parity later fail spurious | Stale Harbor checkout | `git fetch origin && git status`; pull `main` if behind. |
