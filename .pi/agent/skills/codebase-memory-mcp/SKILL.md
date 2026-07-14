---
name: codebase-memory-mcp
description: "Query and index the codebase as a persistent knowledge graph (functions, classes, call chains, routes, cross-service links). Use when the user asks to find code by meaning/structure rather than grep, trace callers/callees or impact analysis, get an architecture overview, run Cypher queries over the code graph, or index/re-index a repo. Trigger phrases include 'trace callers', 'who calls', 'impact analysis', 'call graph', 'architecture overview', 'knowledge graph', 'codebase-memory', 'index the repo', 'search the graph', 'Cypher query over code'. Invoked via the codebase-memory-mcp native CLI (not MCP)."
---

# codebase-memory-mcp - Code Knowledge Graph

`codebase-memory-mcp` builds a persistent knowledge graph of a codebase (functions, classes, call chains, HTTP routes, cross-service links, complexity metrics) from tree-sitter ASTs + LSP type resolution, then answers structural queries in sub-millisecond. 14 tools, 158 languages.

Invoke tools with the **native CLI** shipped in the binary. No Python bridge, no MCP session — one process per call, ~10ms overhead.

Binary path (typical install):

```
/Users/abhishekbhakat/.local/bin/codebase-memory-mcp
```

Prefer bare `codebase-memory-mcp` when it is on `PATH`.

## Project naming (important)

Most query tools (`search_graph`, `query_graph`, `trace_path`, `get_code_snippet`, etc.) require a `project` argument. The project name is derived from the indexed repo's absolute path by **stripping the leading path separator, then replacing every `/` with `-`**. For example:

| Repo path | Project name |
|-----------|--------------|
| `/Users/abhishekbhakat/CODES/kindersystems` | `Users-abhishekbhakat-CODES-kindersystems` |
| `/tmp/cbm-norm-test` | `tmp-cbm-norm-test` |

Do not invent names for unfamiliar repos. If a tool returns `{"error":"project not found or not indexed"}`, the response includes `available_projects` — use that. Or list projects:

```bash
codebase-memory-mcp cli list_projects '{}'
```

## Ownership

The agent owns the `codebase-memory-mcp` lifecycle for the current project — indexing and searching. Do not ask the user to perform these steps; handle them automatically.

- **Index freshness**: re-index when the index may be stale — at the start of a session if the repo changed externally, or after significant code changes (new files, refactors, renamed modules). No need to re-index between consecutive queries if no code changed.
- **Installation**: if the binary is missing (`command not found`):
  ```bash
  curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash -s -- --ui --skip-config
  ```
  (`--ui` is required for the graph visualization UI.)
- **Updates**: `codebase-memory-mcp update` picks up new tools and CLI flags. This skill stays current by calling the binary — no skill-side bridge to regenerate.

## Invoking tools

```bash
codebase-memory-mcp cli [--progress] [--json] <tool_name> [json_args]
```

| Form | When |
|------|------|
| `codebase-memory-mcp cli <tool> '{}'` | No args (or empty object) |
| `codebase-memory-mcp cli <tool> '{"project":"...","query":"..."}'` | Normal call — single JSON object as last arg |
| `codebase-memory-mcp cli --progress <tool> '{...}'` | Long jobs (indexing) — stream progress on stderr |
| `codebase-memory-mcp cli --json <tool> '{...}'` | Wrap result in MCP content envelope (rarely needed) |

Tool names (also printed by `codebase-memory-mcp --help`):

```text
index_repository, search_graph, query_graph, trace_path,
get_code_snippet, get_graph_schema, get_architecture, search_code,
list_projects, delete_project, index_status, detect_changes,
manage_adr, ingest_traces
```

Stdout is the tool result (JSON text). Server logs go to stderr (`level=info msg=mem.init ...`) — ignore them unless diagnosing failures. Non-zero exit means the tool failed or the name is unknown.

## Tools (14)

- `index_repository` — Index a repo into the graph. Required: `repo_path`. Modes: `full` (default), `moderate`, `fast`, `cross-repo-intelligence`. Optional: `persistence` (write shareable artifact), `target_projects` (for cross-repo mode; `["*"]` = all).
- `search_graph` — **Use INSTEAD OF grep/glob** to find definitions, implementations, or relationships. Required: `project`. Modes (combinable): `query` (BM25 full-text, recommended), `name_pattern` (regex), `semantic_query` (array of keyword strings, not a single string). Paginate with `offset`/`limit`; detect truncation via `has_more`. Optional filters: `label`, `qn_pattern`, `file_pattern`, `relationship`, `min_degree`, `max_degree`.
- `query_graph` — Run a **Cypher** query for multi-hop patterns, aggregations, complexity analysis. 100k row ceiling — add `LIMIT` or use `search_graph` pagination for broad queries. Function/Method nodes carry `complexity`, `cognitive`, `loop_count`, `loop_depth`, `transitive_loop_depth`, `linear_scan_in_loop`, `recursive` for hot-path analysis.
- `trace_path` — Trace callers/callees. Required: `project`, `function_name`. `mode`: `calls` (default), `data_flow`, `cross_service`. `direction`: `inbound`, `outbound`, `both` (default). Optional: `depth` (default 3), `parameter_name` (data_flow), `risk_labels`, `include_tests`.
- `get_code_snippet` — Read source for a symbol. Call `search_graph` first to get the exact `qualified_name`, then pass it here. Read tool, not a search tool.
- `get_graph_schema` — Node labels and edge types.
- `get_architecture` — High-level overview: packages, services, dependencies, Leiden community-detection clusters (de-facto modules that often cut across folder layout).
- `search_code` — Graph-augmented grep: finds text, dedupes into containing functions, ranks by structural importance. Modes: `compact` (default), `full`, `files`. No `offset` — raise `limit` or narrow with `file_pattern`/`path_filter`.
- `list_projects` — List indexed projects.
- `delete_project` — Delete a project from the index.
- `index_status` — Indexing status of a project.
- `detect_changes` — Detect code changes and their impact.
- `manage_adr` — Create/update Architecture Decision Records.
- `ingest_traces` — Ingest runtime traces to enhance the graph.

## Typical workflows

### Index (or re-index) the current repo

```bash
codebase-memory-mcp cli --progress index_repository '{"repo_path":"<ABSOLUTE_REPO_PATH>"}'
```

Seconds for average repos. Graph is persisted on disk across calls and sessions.

### List what is indexed

```bash
codebase-memory-mcp cli list_projects '{}'
```

### Find code by meaning

```bash
codebase-memory-mcp cli search_graph '{"project":"<PROJECT_NAME>","query":"database connection pooling"}'
```

Then `get_code_snippet` with the returned `qualified_name` to read source.

### Who calls X / impact analysis

```bash
codebase-memory-mcp cli trace_path '{"project":"<PROJECT_NAME>","function_name":"<name or qualified_name>","mode":"calls","direction":"inbound"}'
```

## Graph UI (`http://localhost:9749`)

Optional 3D visualization. Caveats:

1. The UI stays up only while an MCP stdio server process is alive. One-shot `cli` calls do **not** keep it running.
2. The UI-enabled binary must be installed (`--ui` install variant).

Persistent background UI (hold stdin open so stdio mode does not exit on EOF):

```bash
nohup bash -c 'tail -f /dev/null | codebase-memory-mcp --ui=true --port=9749' > /tmp/cbm-ui.log 2>&1 &
```

Open `http://localhost:9749`. Stop with `pkill -f 'codebase-memory-mcp --ui'`. The UI reads the same on-disk graph that `cli` queries, so re-indexing updates it too.

## Error handling

| Symptom | Action |
|---------|--------|
| `command not found` | Install via the curl command under **Ownership** |
| `unknown tool: ...` | Check spelling; run `codebase-memory-mcp --help` for the tool list |
| `project not found or not indexed` | Use `available_projects` in the error, or `list_projects` |
| `index_repository` fails | Ensure `repo_path` is absolute and readable |
| Wrong params | Re-read the tool notes above; required fields differ per tool |

## Related binary commands

```bash
codebase-memory-mcp --help
codebase-memory-mcp --version
codebase-memory-mcp update
codebase-memory-mcp config list
codebase-memory-mcp install | uninstall
```

These manage the binary itself. Day-to-day graph work uses `cli` only.
