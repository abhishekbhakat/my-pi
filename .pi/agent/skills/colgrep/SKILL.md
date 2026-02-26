---
name: colgrep
description: Semantic code search using ColGREP - combines regex filtering with semantic ranking. Use when the user wants to search code by meaning, find relevant code snippets, or explore a codebase semantically. All local - code never leaves the machine.
user-invocable: false
disable-model-invocation: false
---

# ColGREP Semantic Code Search

ColGREP is a semantic code search tool that combines regex filtering with semantic ranking. It uses multi-vector search (via NextPlaid) to find code by meaning, not just keywords.

## When to use this skill

- Searching for code by semantic meaning ("database connection pooling")
- Finding relevant code snippets when exploring a new codebase
- Combining pattern matching with semantic understanding
- Setting up code search for a new project
- When grep returns too many irrelevant results
- When you don't know the exact naming conventions used in a codebase

## Prerequisites

ColGREP must be installed. It's a single Rust binary with no external dependencies.

## Quick Reference

### Check if ColGREP is installed
```bash
which colgrep || echo "ColGREP not installed"
```

### Install ColGREP
```bash
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/lightonai/next-plaid/releases/latest/download/colgrep-installer.sh | sh
```

### Initialize index for a project
```bash
# Current directory
colgrep init

# Specific path
colgrep init /path/to/project
```

### Basic semantic search
```bash
colgrep "database connection pooling"
```

### Combine regex with semantic search
```bash
colgrep -e "async.*await" "error handling"
```

## Essential Flags

| Flag | Description | Example |
|------|-------------|---------|
| `-c, --content` | **Show full function/class content** with syntax highlighting | `colgrep -c "authentication"` |
| `-e <pattern>` | Pre-filter with regex, then rank semantically | `colgrep -e "def.*auth" "login"` |
| `--include "*.py"` | Filter by file type | `colgrep --include "*.rs" "error handling"` |
| `--code-only` | Skip text/config files (md, yaml, json) | `colgrep --code-only "parser"` |
| `-k <n>` | Number of results (default: 15) | `colgrep -k 5 "database"` |
| `-n <lines>` | Context lines around match | `colgrep -n 10 "config"` |
| `-l, --files-only` | List only filenames | `colgrep -l "test helpers"` |
| `--json` | Output as JSON for scripting | `colgrep --json "api" \| jq '.[].unit.file'` |
| `-y` | Auto-confirm indexing for large codebases | `colgrep -y "search term"` |

## How it works

1. **Tree-sitter parsing** - Extracts functions, methods, classes from code
2. **Structured representation** - Creates rich text with signature, params, docstring, calls, variables
3. **LateOn-Code-edge model** - 17M parameter model creates multi-vector embeddings (runs on CPU)
4. **NextPlaid indexing** - Quantized, memory-mapped, incremental index
5. **Search** - SQLite filtering + semantic ranking with grep-compatible flags

## Recommended Workflow

### For exploring a new codebase:
```bash
# 1. Initialize (one-time)
colgrep init

# 2. Search with content display to see actual code
colgrep -c -k 5 "function that handles user authentication"

# 3. Refine with regex if needed
colgrep -c -e "def.*auth" "login validation"

# 4. Filter by language
colgrep -c --include "*.py" "database connection pooling"
```

### For finding specific patterns:
```bash
# Hybrid search: regex filter + semantic ranking
colgrep -e "class.*View" "API endpoint handling"

# Skip config files, focus on code
colgrep --code-only "error handling middleware"

# Just get filenames for further processing
colgrep -l "unit test helpers"
```

### For scripting/automation:
```bash
# JSON output for piping to other tools
colgrep --json "configuration parser" | jq '.[] | {file: .unit.file, score: .score}'
```

## Pro Tips

1. **Always use `-c` for initial exploration** - Shows full function content, no need to read files separately
2. **Use `-e` to narrow results** - Regex pre-filter is much faster than semantic ranking everything
3. **Index auto-updates** - Each search detects file changes; no need to re-run `init` manually
4. **Large codebases** - Use `-y` to skip confirmation prompts for indexing >10K files

## Example workflow

1. **First time setup** for a project:
   ```bash
   cd /path/to/project
   colgrep init
   ```

2. **Search with content display** (recommended):
   ```bash
   colgrep -c -k 5 "authentication middleware"
   ```

3. **Refine with regex**:
   ```bash
   colgrep -c -e "def.*auth" "login validation"
   ```

4. **The index auto-updates** - each search detects file changes and updates automatically
