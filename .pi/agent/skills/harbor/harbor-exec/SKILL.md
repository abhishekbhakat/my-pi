---
name: harbor-exec
description: "Use when work with Harbor `harbor exec` CLI workflow: compile files, directories, or globs into Harbor tasks; run map jobs; configure artifacts and existence-only verification; use map-reduce; write or review ExecConfig YAML/JSON/TOML; or debug command behavior, config validation, and job outputs."
---

# Harbor Exec

## Overview

Use this skill to operate Harbor `harbor exec` command. Treat `harbor exec` as agentic map-reduce: it turn loose inputs into Harbor tasks, run Harbor jobs over those tasks, and optionally aggregate results.

## First Checks

Assume user run installed Harbor CLI. Check installed command surface before make claims:

```bash
harbor --version
harbor exec --help
```

Require Harbor `>=0.17.1` for `harbor exec`. If `harbor --version` report older version, ask user to upgrade before continue.

Use `--print-config` when debug config resolution, inferred artifacts, task/job directories, or defaults. Do not treat it as substitute for show final launch command.

If installed `harbor` command is not available, ask user how they install Harbor before guess command path.

## Run Parameter Questions

Before run Harbor Exec job, ask user to confirm any unspecified run parameters:

- Inputs: exact paths/globs and whether to `--scan` or `--no-scan`.
- Artifact contract: output file paths agent must write.
- Artifact schemas: required JSON or structured schema for each artifact.
- Environment provider: recommend cloud sandboxing over local `docker`; suggest `modal`, `daytona`, or `e2b`.
- Agent and model for map step.
- Concurrency count.
- Whether to include reduce step, and if so which reduce agent and model to use.
- Final command: show exact launch command before run it.

## Usage Workflow

Prefer flags for one-off runs and `--config` for repeatable or map-reduce workflows.

Make artifacts explicit when correctness depend on generated files:

```bash
harbor exec -p ./input -i "Write /app/answer.json" -f /app/answer.json
```

Prefer explicit artifacts over auto-inferred artifacts. Auto-inference only read inline instructions, not instruction files.

Do not persist compiled tasks by default. Omit `--tasks-dir` unless user want to inspect or reuse compiled tasks; when omitted, compiled tasks are ephemeral and cleaned up after execution.

Leave job output location unset by default. Use `--jobs-dir` only when user want specific output path; default is `jobs`.

Specify `--scan` or `--no-scan` when task cardinality matter. Current flags mode scan single directory or glob by default, but multiple paths are grouped unless `--scan` is explicit.

Do not combine `--config` with flags mode options. Build full `ExecConfig` in file instead.

## Map And Reduce

Map phase:

- `map.compile` define task synthesis: instructions, copied paths, Docker image/workdir, artifacts, templates, and compile-time verifier generation.
- `map.job` define execution: agent, model, environment provider, retries, attempts, concurrency, metrics, and job directory.

Reduce phase:

- Require `map.compile.artifacts`; reducer consume prior map trial artifacts staged under `environment/artifacts`.
- Compile exactly one reducer task.
- Inherit map job settings unless reducer-specific flags/config override them in flags mode.
- Should usually define reducer artifacts explicit, then verify them.

## Examples

Read `references/examples.md` when write concrete commands, config files, or map-reduce examples.
