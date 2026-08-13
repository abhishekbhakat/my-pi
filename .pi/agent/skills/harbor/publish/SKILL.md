---
name: publish
description: Publish Harbor task or dataset to registry. Use when user want to upload, publish, or share tasks or datasets/benchmarks on Harbor registry.
argument-hint: [path/to/task-or-dataset]
---

Help user publish Harbor task or dataset to registry. Walk them through each step, check prerequisites and confirm before run publish commands.

All commands use `uvx harbor` so user do not need to install CLI global.

## Prerequisites

1. **Auth**: Ensure user is logged in by run `uvx harbor auth status`. If not logged in, prompt them to run `uvx harbor auth login`.

2. **Task identifiers**: All tasks must have `[task]` section in their `task.toml` with name like `<org>/<name>`. If missing, run:
   ```bash
   uvx harbor task update "<path/to/task>" --org "<org>"
   ```
   To update all tasks in directory:
   ```bash
   uvx harbor task update "<path/to/tasks>" --org "<org>" --scan
   ```

## Publishing a task

```bash
uvx harbor publish "<path/to/task>"
```

Publish multiple tasks or all tasks in directory:
```bash
uvx harbor publish "<path/to/task-a>" "<path/to/task-b>"
uvx harbor publish "<path/to/tasks>"
```

## Publishing a dataset

### 1. Initialize dataset manifest (if no `dataset.toml` exist)

```bash
uvx harbor dataset init "<org>/<dataset>" \
  --description "<description>" \
  --author "Jane Doe <jane@example.com>"
```

Add `--with-metric` if user need custom metric script. If omitted, dataset use default metric (average reward across tasks, with missing values treated as 0).

**Auto-add behavior:** If `dataset init` is run in directory that already contain tasks, those tasks are automatically added to manifest. After init, **ask user if they want to add additional tasks** — either from Harbor registry or from other local folders.

### 2. Add additional tasks and files (optional)

```bash
cd "<path/to/dataset>"
uvx harbor add "<path/to/task-a>" "<path/to/task-b>"   # local tasks from elsewhere
uvx harbor add "<path/to/folder>" --scan                 # all tasks in another folder
uvx harbor add org/task-name                             # published tasks from registry
uvx harbor add org/dataset-name                          # all tasks from a published dataset
uvx harbor add metric.py                                 # metric file (same dir as dataset.toml)
uvx harbor remove "<org>/<task-name>"                     # remove a task
```

Specific versions: `org/task@tag`, `org/task@revision`, or `org/task@sha256:<hash>`.

### 3. Sync digests (if tasks/metrics change since last publish)

```bash
uvx harbor sync
uvx harbor sync --upgrade   # also upgrade remote tasks to latest
```

### 4. Publish dataset

```bash
uvx harbor publish "<path/to/dataset>"
```

`uvx harbor publish` automatically refresh digests of local tasks in dataset directory.

## Publish options (tasks and datasets)

- `-t / --tag`: add tags (repeatable). `latest` is always included.
- `-c / --concurrency`: control upload concurrency.
- `--public`: make public (private by default).
- `--no-tasks` (datasets only): skip publishing tasks in dataset directory.

Example:
```bash
uvx harbor publish "<path>" -t v1.0 --public
```

## After publishing

- Visibility can be changed later with `uvx harbor task visibility` / `uvx harbor dataset visibility` or on https://hub.harborframework.com/.
- Run published dataset with:
  ```bash
  uvx harbor run -d "<org>/<dataset>@v1.0" -a "<agent>" -m "<model>"
  ```
