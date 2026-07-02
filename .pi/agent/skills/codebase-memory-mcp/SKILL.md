---
name: codebase-memory-mcp
description: "Query and index the codebase as a persistent knowledge graph (functions, classes, call chains, routes, cross-service links). Use when the user asks to find code by meaning/structure rather than grep, trace callers/callees or impact analysis, get an architecture overview, run Cypher queries over the code graph, or index/re-index a repo. Trigger phrases include 'trace callers', 'who calls', 'impact analysis', 'call graph', 'architecture overview', 'knowledge graph', 'codebase-memory', 'index the repo', 'search the graph', 'Cypher query over code'. Bridged from the codebase-memory-mcp MCP server via an executor since Pi does not speak MCP."
---

# codebase-memory-mcp - Code Knowledge Graph

`codebase-memory-mcp` builds a persistent knowledge graph of a codebase (functions, classes, call chains, HTTP routes, cross-service links, complexity metrics) from tree-sitter ASTs + LSP type resolution, then answers structural queries in sub-millisecond. 14 tools, 158 languages.

This skill is a bridge: the underlying server is an MCP stdio server, but **Pi does not speak MCP**. The included `executor.py` spawns the server per call, runs one tool over JSON-RPC, and exits. So every interaction is a one-shot `bash` invocation of `executor.py` — no long-lived connection, no agent-driven session.

## Skill location

The skill directory is fixed at:

```
/Users/abhishekbhakat/CODES/my-pi/.pi/agent/skills/codebase-memory-mcp
```

All examples below assume you `cd` there first.

## Project naming (important)

Most query tools (`search_graph`, `query_graph`, `trace_path`, `get_code_snippet`, etc.) require a `project` argument. The project name is derived from the indexed repo's absolute path by **stripping the leading path separator, then replacing every `/` with `-`**. For example:

| Repo path | Project name |
|-----------|--------------|
| `/Users/abhishekbhakat/CODES/kindersystems` | `Users-abhishekbhakat-CODES-kindersystems` |
| `/tmp/cbm-norm-test` | `tmp-cbm-norm-test` |

Do not try to compute the name by hand for unfamiliar repos — if a tool returns `{"error":"project not found or not indexed"}`, the error response includes an `available_projects` list; use it to get the exact name. You can also list projects at any time:

```bash
./executor.py --call '{"tool":"list_projects","arguments":{}}'
```

## Ownership

The agent owns the `codebase-memory-mcp` lifecycle for the current project — indexing and searching. Do not ask the user to perform these steps; handle them automatically.

- **Index freshness**: keep the graph up to date. Re-index when the index may be stale — at the start of a session if the repo changed externally, or after significant code changes (new files, refactors, renamed modules). No need to re-index between consecutive queries if no code changed.
- **Installation**: if `executor.py` fails with "command not found" for the server binary, the user needs to install codebase-memory-mcp:
  ```bash
  curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash -s -- --ui --skip-config
  ```
  (the `--ui` variant is required if they also want the graph visualization UI.)

## Invoking tools

Three executor modes:

```bash
# 1. List all available tools (name + description)
./executor.py --list

# 2. Get the full JSON schema for one tool (params, required, enum)
./executor.py --describe index_repository

# 3. Call a tool with JSON arguments
./executor.py --call '{"tool":"<tool_name>","arguments":{...}}'
```

Always `--describe` a tool the first time you use it in a session to learn its exact parameter names and required fields — the summaries below are shorthand, not full schemas.

## Tools (14)

- `index_repository` - Index a repo into the graph. Required: `repo_path`. Modes: `full` (default), `moderate`, `fast`, `cross-repo-intelligence`.
- `search_graph` - **Use INSTEAD OF grep/glob** to find definitions, implementations, or relationships. Three independent modes: `query` (BM25 full-text, recommended for natural language), `name_pattern` (regex), `semantic_query` (vector cosine, bridges vocabulary). Paginate with `offset`/`limit`; detect truncation via `has_more`.
- `query_graph` - Run a **Cypher** query for multi-hop patterns, aggregations, complexity analysis. 100k row ceiling — add `LIMIT` or use `search_graph` pagination for broad queries. Function/Method nodes carry `complexity`, `cognitive`, `loop_count`, `loop_depth`, `transitive_loop_depth`, `linear_scan_in_loop`, `recursive` for hot-path analysis.
- `trace_path` - Trace callers/callees (`mode=calls`), data flow (`mode=data_flow`), or cross-service paths through HTTP/async routes (`mode=cross_service`). Use INSTEAD OF grep for impact analysis.
- `get_code_snippet` - Read source for a symbol. Call `search_graph` first to get the exact `qualified_name`, then pass it here. Read tool, not a search tool.
- `get_graph_schema` - Get node labels and edge types of the graph.
- `get_architecture` - High-level overview: packages, services, dependencies, Leiden community-detection clusters (the de-facto modules that often cut across folder layout).
- `search_code` - Graph-augmented grep: finds text, dedupes into containing functions, ranks by structural importance. Modes: `compact` (default, token-efficient), `full`, `files`. No `offset` — raise `limit` or narrow with `file_pattern`/`path_filter` to see more.
- `list_projects` - List all indexed projects.
- `delete_project` - Delete a project from the index.
- `index_status` - Indexing status of a project.
- `detect_changes` - Detect code changes and their impact.
- `manage_adr` - Create/update Architecture Decision Records.
- `ingest_traces` - Ingest runtime traces to enhance the graph.

## Typical workflows

### Index (or re-index) the current repo

```bash
./executor.py --call '{"tool":"index_repository","arguments":{"repo_path":"<ABSOLUTE_REPO_PATH>"}}'
```

This takes seconds for average repos. The graph is persisted to disk, so it survives across calls and sessions.

### Find code by meaning

```bash
./executor.py --call '{"tool":"search_graph","arguments":{"project":"<PROJECT_NAME>","query":"database connection pooling"}}'
```

Then use `get_code_snippet` with the returned `qualified_name` to read the actual source.

### Who calls X / impact analysis

```bash
./executor.py --describe trace_path   # learn exact params first
./executor.py --call '{"tool":"trace_path","arguments":{"project":"<PROJECT_NAME>","mode":"calls","direction":"upstream","target":"<qualified_name>"}}'
```

## Status check

To see what is currently indexed:

```bash
./executor.py --call '{"tool":"list_projects","arguments":{}}'
```

## The localhost:9749 graph UI (separate from this skill)

The server has an optional 3D graph visualization UI at `http://localhost:9749`. Two important caveats:

1. **The UI only stays up while the MCP stdio server is alive and connected to a client.** This skill's `executor.py` spawns the server per call and exits immediately, so the UI does **not** persist through skill invocations.
2. **The UI variant of the binary must be installed** (standard build has no embedded UI).

To run the UI as a persistent background server (no MCP client needed), hold stdin open so the stdio server doesn't exit on EOF:

```bash
nohup bash -c 'tail -f /dev/null | /Users/abhishekbhakat/.local/bin/codebase-memory-mcp --ui=true --port=9749' > /tmp/cbm-ui.log 2>&1 &
```

Then open `http://localhost:9749` in a browser. Stop it with `pkill -f 'codebase-memory-mcp --ui'`. The UI reads the same persisted graph that this skill's tools query, so re-indexing via `index_repository` updates the visualization too.

## Error handling

If `executor.py` returns an error:
- Run `./executor.py --describe <tool_name>` to confirm the exact parameter names and required fields.
- Verify the MCP server binary exists at `/Users/abhishekbhakat/.local/bin/codebase-memory-mcp` (reinstall via the curl command under **Ownership** if missing).
- For `index_repository` failures, check the `repo_path` is absolute and readable.
- The first run of `executor.py` may take a few seconds while `uv` resolves the inline `mcp` dependency; subsequent calls are fast.

---

*Auto-generated from the codebase-memory-mcp MCP server by mcp_to_skill.py, then polished to Pi skill conventions.*
