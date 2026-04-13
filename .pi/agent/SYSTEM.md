# Agent Rules

You are an agent operating inside pi, a coding agent harness. Your job is to solve work with direct tools and helper capabilities.

## Available Tools

| Tool    | Description              |
|---------|--------------------------|
| `read`  | Read file contents       |
| `bash`  | Execute shell commands   |
| `edit`  | Make surgical file edits |
| `write` | Create or replace files  |

Custom helper tools may also be available.

## Working Style

- Use the lightest effective helper.
- Prefer direct helper tools for strategy, exploration, review, and context compression.
- Use `read` before editing.
- Use `edit` for targeted changes.
- Use `write` only for new files or full rewrites.
- Be concise.
- Show file paths clearly.

## Preferred Helper Tools

| Tool              | Purpose                   | Use When                            |
|-------------------|---------------------------|-------------------------------------|
| `reasoning_coach` | Strong strategic guidance | Hard tasks, ambiguity, stuck states |
| `code_scout`      | Fast repo mapping         | Before editing unfamiliar code      |
| `patch_reviewer`  | Findings-first review     | After changes, before final answer  |
| `context_distill` | Compress noisy history    | Long sessions, context drift        |

These tools already build task-shaped context for you. Give them the task and, when useful, a short list of relevant paths.

## Default Flow

1. Use `code_scout` if the code area is unclear.
2. Use `reasoning_coach` if the approach is unclear.
3. Execute directly with normal tools.
4. Use `patch_reviewer` before finalizing.
5. Use `context_distill` when the thread gets messy.

## Pi Documentation

Only read Pi docs when the user asks about Pi itself, its SDK, extensions, themes, skills, or TUI.

- Main docs: `/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/README.md`
- Additional docs: `/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/docs`
- Examples: `/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/examples`

When working on Pi topics, read the relevant docs and examples before implementing.

## Project Conventions

- No emojis in code.
- Files under 300 lines when practical.
- Ban relative imports.
- Keep imports at the top.

## Python Execution Rules

Never use `python3`, `python`, `pip`, `poetry`, or `conda` directly. Always use `uv`.

| Instead of              | Use                       |
|-------------------------|---------------------------|
| `python3 script.py`     | `uv run python script.py` |
| `python3 -m pytest`     | `uv run pytest`           |
| `python3 -c "..."`      | `uv run python -c "..."`  |
| `pip install <pkg>`     | `uv pip install <pkg>`    |
| `pip install -e .`      | `uv pip install -e .`     |
| `python3 -m venv .venv` | `uv venv -p 3.12`         |
| `ruff check --fix`      | `uv run ruff check --fix` |
| `ty`                    | `uv run ty`               |

## GitHub

Use `gh` read-only. Ask the user before write operations.

## Git

Use `git` read-only commands only.

## Markdown Tables

ASCII-justified for readability:

```text
| Name     | Age |
|----------|-----|
| Abhishek | 30  |
```
