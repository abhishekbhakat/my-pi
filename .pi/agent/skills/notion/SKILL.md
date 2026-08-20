---
name: notion
description: "Hosted Notion MCP via OAuth (mcp-remote). Search/fetch pages, create/update content, databases, comments, views, meeting notes. Use when user mention Notion, Notion MCP, OAuth Notion, or workspace notes."
user-invocable: true
disable-model-invocation: false
---

# notion Skill

Hosted Notion MCP. OAuth. Act as you.

- URL: `https://mcp.notion.com/mcp`
- Proxy: `mcp-remote` (stdio)
- Tokens: `~/.mcp-auth/` (not in this dir)

## Auth (OAuth)

**Do now — first time or expired:**

```bash
cd $SKILL_DIR
./executor.py --list
```

Browser open → sign Notion → token cache auto-refresh after.

**Auth dead?**

```bash
rm -rf ~/.mcp-auth
./executor.py --list
```

**Force proxy alone:**

```bash
npx -y mcp-remote https://mcp.notion.com/mcp --transport http-only
```

Optional: `MCP_REMOTE_CONFIG_DIR` move token store off `~/.mcp-auth`.

## Tools (28)

Schema for one tool:

```bash
./executor.py --describe <tool>
```

### Do-now (read)

| Tool                         | Purpose                                                         |
| ---------------------------- | --------------------------------------------------------------- |
| `notion-search`              | Search workspace + connected sources; ranked results            |
| `notion-fetch`               | Page/DB/data-source by URL or ID; markdown; `id: "self"` for me |
| `notion-list-recent-pages`   | Recently viewed                                                 |
| `notion-list-favorite-pages` | Favorite / pinned                                               |
| `notion-list-private-pages`  | Private sidebar                                                 |
| `notion-list-shared-pages`   | Shared sidebar                                                  |
| `notion-query-meeting-notes` | Filter my meeting notes                                         |
| `notion-get-comments`        | Read discussions on page                                        |
| `notion-get-users`           | Workspace users; `user_id: "self"`                              |
| `notion-get-teams`           | Teamspaces                                                      |
| `notion-get-async-task`      | Poll async jobs                                                 |
| `notion-search-agents`       | Search / browse agents                                          |

### Write / structure

| Tool                           | Purpose                                                  |
| ------------------------------ | -------------------------------------------------------- |
| `notion-create-pages`          | Create page(s); parent page/data source or private       |
| `notion-update-page`           | Props + content (replace / update / insert markdown)     |
| `notion-move-pages`            | Move pages/DBs to new parent                             |
| `notion-duplicate-page`        | Async duplicate                                          |
| `notion-create-comment`        | Page or block comment / reply                            |
| `notion-create-database`       | DB via SQL DDL or typed template (tasks/projects/skills) |
| `notion-update-data-source`    | Alter data-source schema via SQL DDL                     |
| `notion-query-data-sources`    | Query rows via SQL or view mode                          |
| `notion-create-view`           | Create database / linked view                            |
| `notion-update-view`           | Rename / filter / sort / group view                      |
| `notion-create-folder`         | Empty Notion Folder                                      |
| `notion-update-folder`         | Add/remove files or nested folder                        |
| `notion-create-attachment`     | Upload text / URL / file-upload attachment               |
| `notion-create-file-upload`    | Short-lived multipart upload URL                         |
| `notion-download-attachment`   | Download small UTF-8 attachment from MCP                 |
| `notion-convert-page-to-skill` | Mark page as AI skill                                    |

## Call pattern

1. Pick tool from tables (or `--list`)
2. Unknown params → `--describe <tool>`
3. Run call:

```bash
cd $SKILL_DIR
./executor.py --call '{"tool":"notion-search","arguments":{"query":"roadmap"}}'
```

IDs: bare UUID, dashed UUID, or full Notion URL.

## Workflows

### Who am I

```bash
./executor.py --call '{"tool":"notion-fetch","arguments":{"id":"self"}}'
```

### Search → read

```bash
./executor.py --call '{"tool":"notion-search","arguments":{"query":"Q2 plan"}}'
./executor.py --call '{"tool":"notion-fetch","arguments":{"id":"PAGE_ID_OR_URL"}}'
```

### Create private page

```bash
./executor.py --call '{"tool":"notion-create-pages","arguments":{"pages":[{"properties":{"title":"Notes"},"content":"## Agenda\n\n- Item 1"}]}}'
```

### Create child page

```bash
./executor.py --call '{"tool":"notion-create-pages","arguments":{"parent":{"page_id":"PARENT_ID"},"pages":[{"properties":{"title":"Child"},"content":"Body"}]}}'
```

### Edit body (search/replace)

```bash
./executor.py --call '{"tool":"notion-update-page","arguments":{"page_id":"PAGE_ID","command":"update_content","content_updates":[{"old_str":"Draft","new_str":"Final"}]}}'
```

### DB row flow

```bash
# 1. fetch DB → data source id from <data-source url="collection://...">
./executor.py --call '{"tool":"notion-fetch","arguments":{"id":"DATABASE_ID_OR_URL"}}'
# 2. query
./executor.py --call '{"tool":"notion-query-data-sources","arguments":{"data":{"data_source_urls":["collection://DATA_SOURCE_ID"],"query":"SELECT * FROM \"collection://DATA_SOURCE_ID\" LIMIT 20"}}}'
# 3. create row
./executor.py --call '{"tool":"notion-create-pages","arguments":{"parent":{"data_source_id":"DATA_SOURCE_ID"},"pages":[{"properties":{"Name":"New task"}}]}}'
```

### Comment

```bash
./executor.py --call '{"tool":"notion-create-comment","arguments":{"page_id":"PAGE_ID","markdown":"Looks good."}}'
```

## Markdown / docs

Do **not** invent markdown. Read specs first:

```bash
./executor.py --call '{"tool":"notion-fetch","arguments":{"id":"notion://docs/enhanced-markdown-spec"}}'
./executor.py --call '{"tool":"notion-fetch","arguments":{"id":"notion://docs/view-dsl-spec"}}'
```

Prefer fetch / create / update tools. No raw block trees.

## Rules

1. **Never** hardcode OAuth tokens in files, commits, chat.
2. Confirm destructive ops (`replace_content`, `allow_deleting_content`, trash) with user.
3. Encode newlines as `\n` inside JSON strings.
4. DB vs data source: fetch DB first; query/create on `data_source_id` / `collection://...`.
5. Plan gate / rate limit → surface message; no retry loop.
6. Unfamiliar tool → `--describe` before first call.

## Errors

| Symptom                         | Fix                                                       |
| ------------------------------- | --------------------------------------------------------- |
| Browser / authorize URL printed | Finish Notion OAuth in browser                            |
| Auth fail after idle            | `rm -rf ~/.mcp-auth` then `./executor.py --list`          |
| `object_not_found`              | Wrong ID or no access in this workspace                   |
| `validation_error`              | Bad property shape; fetch schema first                    |
| Tool not found                  | `--list`; names use `notion-` prefix                      |
| mcp-remote / npx fail           | Need network + Node; retry `npx -y mcp-remote@latest ...` |

## Refs

- Hosted MCP: https://mcp.notion.com/mcp
- Notion MCP docs: https://developers.notion.com/guides/mcp/get-started-with-mcp
- mcp-remote: https://www.npmjs.com/package/mcp-remote
