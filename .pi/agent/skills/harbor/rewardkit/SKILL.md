---
name: rewardkit
description: Write Harbor task verifiers using Reward Kit. Use when create or edit
  task tests/ directory, add grading criteria, set up LLM/agent judges, or design
  verifiers that produce reward score.
---

Help user write task verifiers with Reward Kit. Reward Kit is lightweight Python
package that turn directory of criteria files into reward score. Each criterion
is Python function call or TOML judge file; folders become separate rewards.

## Setup in Harbor task

Put criteria alongside `test.sh` in task `tests/` directory:

```
tests/
├── test.sh
├── checks.py         # programmatic criteria
└── judge.toml        # optional LLM/agent judge
```

`tests/test.sh`:
```bash
#!/bin/bash
uvx --from 'harbor-rewardkit==0.1.*' rewardkit /tests
```

This run all criteria in `/tests/` against workspace at `/app` and write
`/logs/verifier/reward.json`. Defaults match Harbor conventions — no extra
config needed.

Judge criteria need API keys, pass through `task.toml`:
```toml
[verifier.env]
ANTHROPIC_API_KEY = "${ANTHROPIC_API_KEY}"
```

Ask whether Reward Kit should run in agent shared environment or separate
verifier environment. Prefer separate verifier environment when judge prompts,
grading dependencies, API keys, or clean-room checks should not be available
to agent:

```toml
[environment]
network_mode = "no-network"   # Agent env baseline — offline during agent.run()

[verifier]
environment_mode = "separate"

[verifier.environment]
network_mode = "public"     # Verifier env baseline — LLM judge API calls
docker_image = "python:3.12-slim"
```

In shared mode, verifier run in agent container and inherit
`[environment].network_mode`. Put `[verifier].network_mode` only when verify()
need different network access than agent phase (phase override, not baseline).
If agent and verifier need different baselines without runtime switching, use
`environment_mode = "separate"` and set `[verifier.environment].network_mode`.

Judge criteria that call external APIs need `public` baseline or allowlist on
verifier environment. Programmatic checks that only read local files can use
`no-network`.

In separate mode, `tests/` is verifier image build context and must provide
`/tests/test.sh` at runtime; Harbor do not upload `tests/` into running
verifier container.

## Programmatic criteria

Call built-ins from any `.py` file in `tests/`:

```python
import rewardkit as rk

rk.file_exists("output.txt")
rk.file_contains("output.txt", "hello")
rk.command_succeeds("python main.py", weight=2.0)
rk.json_key_equals("result.json", "status", "ok")
```

All criteria accept `weight` (default `1.0`) and `isolated` (default `False`,
run in overlayfs so side effects do not leak).

### Available built-ins

- **Files**: `file_exists`, `file_not_exists`, `file_contains`, `file_contains_regex`,
  `file_matches`, `files_equal`, `diff_ratio`
- **Commands**: `command_succeeds`, `command_output_contains`, `command_output_matches`,
  `command_output_matches_regex` (30s default timeout, optional `cwd`)
- **Data**: `json_key_equals`, `json_path_equals`, `csv_cell_equals`, `xlsx_cell_equals`
  (need `[office]` extra), `sqlite_query_equals`
- **HTTP**: `http_status_equals`, `http_response_contains`
- **Images**: `image_similarity`, `image_size_equals` (need `[image]` extra)
- **Trajectory**: `trajectory_tool_used`, `trajectory_tool_not_used`, `trajectory_turn_count`

For extras, install with `uv tool install harbor-rewardkit[all]`.

## Custom criteria

Use `@criterion` decorator. First parameter always `workspace: Path`. Return
`bool` or `float`:

```python
from pathlib import Path
from rewardkit import criterion

@criterion
def has_valid_output(workspace: Path) -> bool:
    return (workspace / "output.txt").read_text().strip() != ""
```

Zero-parameter criteria auto-register. Criteria with extra args must be called
via `rk`:

```python
@criterion(description="output has at least {n} lines")
def has_n_lines(workspace: Path, n: int) -> bool:
    return len((workspace / "output.txt").read_text().splitlines()) >= n

rk.has_n_lines(10, weight=2.0)
rk.has_n_lines(50, weight=1.0)
```

For criteria shared across reward subdirs, define with `shared=True` in
root-level file and call from subdirs.

## Judge criteria (LLM or agent-as-a-judge)

For subjective checks (quality, readability, edge cases), create TOML file:

```toml
[judge]
judge = "anthropic/claude-sonnet-4-6"   # LiteLLM model string
files = ["/app/main.py"]

[[criterion]]
description = "Is the code correct?"
type = "binary"

[[criterion]]
description = "How readable is the code?"
type = "likert"
points = 5
weight = 2.0
```

Criterion types:
- `binary` — yes/no = 1.0 or 0.0
- `likert` — 1..points, normalized to [0, 1]
- `numeric` — min..max, normalized to [0, 1]

### Agent judges

Agent judges shell out to CLI and can explore filesystem:

```toml
[judge]
judge = "claude-code"
model = "anthropic/claude-sonnet-4-6"
isolated = true

[[criterion]]
description = "Does the solution handle edge cases?"
type = "binary"
```

Slower and more expensive than LLM judges, but can run commands and inspect
files.

### Useful `[judge]` options

`timeout` (default 300), `reasoning_effort` (`low`|`medium`|`high`),
`reference` (path to reference solution), `atif-trajectory` (evaluate agent
trajectory), `weight`, `prompt_template` (custom prompt with `{criteria}`
placeholder).

### Scoring aggregation (within one judge TOML)

```toml
[scoring]
aggregation = "all_pass"   # weighted_mean | all_pass | any_pass | threshold
threshold = 0.7             # only for threshold
```

Affect only how this file own criteria combine. To aggregate *across*
dimensions, see [Aggregating dimensions](#aggregating-dimensions).

## Multi-reward tasks

Put criteria in subdirectories — each become separate reward:

```
tests/
├── test.sh
├── correctness/
│   └── check.py
├── structure/
│   └── files_exist.py
└── quality/
    └── quality.toml
```

Produces:
```json
{ "correctness": 0.75, "structure": 1.0, "quality": 0.6 }
```

### Aggregating dimensions

To add aggregated scores on top of per-dimension keys, add root-level
`tests/reward.toml` with one or more `[[reward]]` tables. Each add one key to
`reward.json`, aggregate dimensions with same modes as `[scoring]`:

```toml
# tests/reward.toml
[[reward]]
name = "reward"
aggregation = "all_pass"   # weighted_mean | all_pass | any_pass | threshold
# threshold = 0.7          # only for threshold
```

```json
{ "correctness": 0.75, "structure": 1.0, "quality": 0.6, "reward": 0.0 }
```

Per-dimension scores stay; aggregated keys added alongside them (`name` may not
collide with dimension). Each dimension weighted by sum of its criteria
weights; `reward-details.json` keep full breakdown.

## Output files

- `/logs/verifier/reward.json` — per-reward scores
- `/logs/verifier/reward-details.json` — per-criterion results, judge reasoning, errors

## Multi-step tasks

In multi-step task, each step have own `tests/` under `steps/{name}/tests/`,
verifier run once per step. Reward Kit behave same as single-step task: for
each step read `/tests`, run criteria against `/app`, write
`/logs/verifier/reward.json` for that step. Harbor then aggregate per-step
results into trial-level reward via `multi_step_reward_strategy` in `task.toml`
— aggregation happen *outside* Reward Kit, so do not encode cross-step logic in
criteria.

Task-level `tests/` directory (at task root) uploaded to `/tests` first, then
step own `tests/` layered on top (same-name files win). Put shared helpers
(common `checks.py` functions with `shared=True`, fixture files, fallback
`test.sh`) at task level, and step-specific criteria under each step.

Multi-reward subdirectories work *within* step: `steps/foo/tests/` can contain
`correctness/`, `structure/`, `quality/` — each produce separate reward key for
that step, and `multi_step_reward_strategy = "mean"` average each key across
steps. Use `"final"` when last step is end-to-end check whose rewards already
represent full task.

## When to reach for what

- **Built-ins** for file existence, string matches, command output, JSON/CSV checks,
  HTTP probes.
- **`@criterion`** when logic task-specific but programmatic.
- **LLM judges** for subjective quality dimensions (readability, correctness of prose).
- **Agent judges** when rubric require explore filesystem or run code
  (e.g. "does test suite pass?").
- **Subdirectories** when you want separate scores (correctness vs structure vs
  quality) rather than one blended number.
- **`isolated=True`** for any criterion that run mutating commands, so it do not
  corrupt workspace for other criteria.

## Working example

See `examples/tasks/reward-kit-example/` in Harbor repo.
