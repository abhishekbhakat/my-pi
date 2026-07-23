---
name: notion
description: "Read and write Notion pages, databases, data sources, comments, and markdown via the Notion REST API. Use when the user mentions Notion, ntn tokens, Notion pages/databases, workspace notes, or wants to search/create/update Notion content."
user-invocable: true
disable-model-invocation: false
---

# Notion Skill

Work with a Notion workspace through the official REST API (`Notion-Version: 2026-03-11`).

This skill is **token-based and headless** (PAT or internal integration secret). It does not use the hosted Notion MCP OAuth flow.

## Authentication

Precedence:

1. Environment: `NOTION_API_KEY`, `NOTION_TOKEN`, or `NOTION_PAT`
2. `notion-auth.json` in this skill directory (copy from `notion-auth.sample.json`)

```bash
cp notion-auth.sample.json notion-auth.json
# put token in access_token
```

### Recommended: personal access token (PAT)

1. Open https://www.notion.so/developers/tokens
2. **New token** → enable **Notion API** capability
3. Copy the `ntn_...` token into `notion-auth.json` or export `NOTION_API_KEY`

PAT notes:

- Acts as **you** (your page permissions). No "share with connection" step.
- Can create private workspace-level pages (omit parent / `workspace: true`).
- `list_users` is **not** available for PATs. Use `whoami` instead.

### Alternative: internal integration

1. https://www.notion.so/my-integrations → new integration
2. Copy the secret
3. In Notion, open each page/database → **...** → **Connections** → add the integration

Internal bots only see content explicitly shared with them.

Optional: set `notion_version` in auth JSON or `NOTION_VERSION` env (default `2026-03-11`).

## Executor

All calls go through `executor.py` in this directory.

```bash
cd $SKILL_DIR
./executor.py --list
./executor.py --describe search
./executor.py --normalize-id "https://www.notion.so/My-Page-195de9221179449fab8075a27c979105"
./executor.py --call '{"tool":"whoami","arguments":{}}'
```

Replace `$SKILL_DIR` with this skill's path (under the installed agent skills tree).

## Tools

| Tool                   | Purpose                                                        |
|------------------------|----------------------------------------------------------------|
| `whoami`               | Current token identity (`GET /v1/users/me`)                    |
| `search`               | Title search across pages / data sources                       |
| `get_page`             | Page properties/metadata                                       |
| `get_page_markdown`    | Full page body as enhanced markdown (preferred for reading)    |
| `create_page`          | Create page or database row (`markdown` supported)             |
| `update_page`          | Update properties, icon, cover, archived/trash                 |
| `update_page_markdown` | Edit body: `update_content` / `replace_content` / insert       |
| `move_page`            | Move page under a new parent                                   |
| `get_database`         | Database metadata + data sources                               |
| `get_data_source`      | Schema/properties for querying and row creation                |
| `query_data_source`    | Filter/sort database rows                                      |
| `list_children`        | List child blocks                                              |
| `append_children`      | Append block children                                          |
| `get_block`            | Retrieve a block                                               |
| `update_block`         | Update a block                                                 |
| `delete_block`         | Delete/archive a block                                         |
| `list_comments`        | Comments on a page/block                                       |
| `create_comment`       | Add a comment (`text` shortcut or `rich_text`)                 |
| `list_users`           | Workspace users (internal integration only)                    |
| `get_user`             | Single user                                                    |
| `get_async_task`       | Poll async create/markdown jobs                                |
| `raw`                  | Escape hatch: any method + path + JSON body                    |

## Usage pattern

**Step 1 — identify tool**

```bash
./executor.py --list
./executor.py --describe <tool>
```

**Step 2 — call**

```bash
./executor.py --call '{"tool":"search","arguments":{"query":"roadmap","filter_object":"page","page_size":10}}'
```

IDs may be bare UUIDs (with/without dashes) or full Notion URLs.

## Common workflows

### Search then read

```bash
./executor.py --call '{"tool":"search","arguments":{"query":"Q2 plan","filter_object":"page"}}'
./executor.py --call '{"tool":"get_page_markdown","arguments":{"id":"PAGE_ID_OR_URL"}}'
```

### Create a private page (PAT)

```bash
./executor.py --call '{"tool":"create_page","arguments":{"workspace":true,"icon":{"emoji":"🚀"},"markdown":"# Hello\n\nCreated by the agent."}}'
```

### Create a child page

```bash
./executor.py --call '{"tool":"create_page","arguments":{"parent_page_id":"PARENT_ID","title":"Notes","markdown":"## Agenda\n\n- Item 1\n- Item 2"}}'
```

### Edit page body (search/replace)

```bash
./executor.py --call '{"tool":"update_page_markdown","arguments":{"id":"PAGE_ID","command":"update_content","content_updates":[{"old_str":"Draft","new_str":"Final"}]}}'
```

### Replace entire page body

```bash
./executor.py --call '{"tool":"update_page_markdown","arguments":{"id":"PAGE_ID","command":"replace_content","new_str":"# New title\n\nFull replacement"}}'
```

### Database row workflow

```bash
# 1. Resolve database → data source
./executor.py --call '{"tool":"get_database","arguments":{"id":"DATABASE_ID_OR_URL"}}'
# 2. Inspect schema
./executor.py --call '{"tool":"get_data_source","arguments":{"id":"DATA_SOURCE_ID"}}'
# 3. Query
./executor.py --call '{"tool":"query_data_source","arguments":{"id":"DATA_SOURCE_ID","filter":{"property":"Status","status":{"equals":"Todo"}},"page_size":20}}'
# 4. Create row
./executor.py --call '{"tool":"create_page","arguments":{"parent_data_source_id":"DATA_SOURCE_ID","properties":{"Name":{"title":[{"text":{"content":"New task"}}]}}}}'
```

### Comment

```bash
./executor.py --call '{"tool":"create_comment","arguments":{"page_id":"PAGE_ID","text":"Looks good — shipping."}}'
```

### Raw endpoint

```bash
./executor.py --call '{"tool":"raw","arguments":{"method":"GET","path":"/v1/users/me"}}'
```

## Databases vs data sources

Modern Notion API separates:

- **Database** — container (views live here)
- **Data source** — schema + rows you query/create against

Always:

1. `get_database` → read `data_sources`
2. `get_data_source` / `query_data_source` / create with `parent_data_source_id`

Do **not** use deprecated `POST /v1/databases/{id}/query` patterns unless forced by old docs.

## Markdown guidance

Prefer `get_page_markdown` / `create_page.markdown` / `update_page_markdown` over assembling block trees.

See [references/markdown.md](references/markdown.md) for enhanced markdown syntax (callouts, toggles, tables, mentions, colors).

See [references/api.md](references/api.md) for filters, property shapes, pagination, and limits.

## Important rules

1. **Never hardcode tokens** into skill files, commits, or chat logs.
2. **Confirm destructive ops** (`replace_content`, `allow_deleting_content`, trash/archive) with the user when content loss is possible.
3. **Share pages with internal integrations** before expecting them to appear in search.
4. **Encode newlines as `\n`** inside JSON string arguments.
5. **Paginate**: follow `has_more` / `next_cursor` (max `page_size` 100).
6. **Rate limits**: ~3 req/s average; on 429/529 wait for `Retry-After`.
7. Property names in filters/writes must match the data source schema exactly.

## Error handling

| Symptom                         | Fix |
|---------------------------------|-----|
| `unauthorized`                  | Bad/expired token; recreate PAT or check integration secret |
| `object_not_found`              | Wrong ID, or page not shared with internal integration |
| `restricted_resource` / 403     | Missing capability or page access |
| `validation_error`              | Bad property shape, missing required title, bad markdown command match |
| `rate_limited` (429)            | Back off using `Retry-After` |
| `list_users` fails on PAT       | Expected — use `whoami` |

## Optional: hosted Notion MCP

If you prefer OAuth MCP tools in another client:

- URL: `https://mcp.notion.com/mcp` (streamable HTTP)
- Tools: `notion-search`, `notion-fetch`, `notion-create-pages`, `notion-update-page`, etc.
- Docs: https://developers.notion.com/guides/mcp/get-started-with-mcp

This skill intentionally uses the REST executor so agents can run authenticated calls from the shell without interactive OAuth.

## References

- [references/api.md](references/api.md) — endpoints, filters, properties, auth
- [references/markdown.md](references/markdown.md) — enhanced markdown + update commands
- Official index: https://developers.notion.com/llms.txt
