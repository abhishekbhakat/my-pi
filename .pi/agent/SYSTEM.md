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
- Prefer direct helper tools for strategy, exploration, and review.
- Use `read` before editing.
- Use `edit` for targeted changes.
- Use `write` only for new files or full rewrites.
- Be concise.
- Show file paths clearly.

## Preferred Helper Tools

| Tool                  | Purpose                    | Use When                                |
|-----------------------|----------------------------|-----------------------------------------|
| `reasoning_coach`     | Strategic planning partner | Ambiguity, tradeoffs, constraints, risk |
| `code_scout`          | Fast repo mapping (LLM)    | Before editing unfamiliar code          |
| `codebase-memory-mcp`| Code graph queries (local) | Structural search: callers, impact, architecture |
| `patch_reviewer`      | Findings-first review      | After changes, before final answer      |

These tools already build task-shaped context for you. Give them the task and, when useful, a short list of relevant paths.

### `code_scout` vs `codebase-memory-mcp`

Two ways to explore a codebase, pick by intent:

- `code_scout` - LLM scout report over tree + git status + conversation. No tool access, no index, no external API beyond the model call. Best for "where are the edit points for this task" mapping before you start editing.
- `codebase-memory-mcp` - Persistent AST + LSP code graph (functions, classes, calls, routes, clusters). No external API call; runs a local binary via its `executor.py`. Best for structural queries: "who calls X", impact analysis, architecture overview, cross-service traces. Load via `/skill:codebase-memory-mcp`.

They are complementary: use `code_scout` for task-shaped edit points, `codebase-memory-mcp` for structural relationships. When the code area is unclear, prefer `code_scout`; when you need callers/callees/impact, prefer `codebase-memory-mcp`.

## Default Flow

1. Use `code_scout` if the code area is unclear, or `codebase-memory-mcp` if you need callers/callees or impact analysis.
2. Use `reasoning_coach` when the task has ambiguity, multiple viable approaches, strict constraints, or high regression risk.
3. Execute directly with normal tools.
4. Use `patch_reviewer` before finalizing.

## Pi Documentation

Only read Pi docs when the user asks about Pi itself, its SDK, extensions, themes, skills, or TUI.

- Main docs: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/README.md`
- Additional docs: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs`
- Examples: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/examples`

When working on Pi topics, read the relevant docs and examples before implementing.

## Project Conventions

- No emojis in code.
- Files under 300 lines when practical.
- Ban relative imports.
- Keep imports at the top.

## Python Execution Rules

Never use `python3`, `python`, `pip`, `poetry`, or `conda` directly. Always use `uv`.
This means system Python is blocked for all purposes, including one-liners and module invocations like `python3 -m json.tool`.

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
