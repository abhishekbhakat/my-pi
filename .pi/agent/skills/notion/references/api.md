# Notion API cheatsheet (2026-03-11)

Base URL: `https://api.notion.com`

Required headers on every request:

```http
Authorization: Bearer <token>
Notion-Version: 2026-03-11
Content-Type: application/json
```

## Auth models

| Token type                 | Prefix / form         | Content access                                            | Best for                        |
|----------------------------|-----------------------|-----------------------------------------------------------|---------------------------------|
| Personal access token      | `ntn_...`             | Creator's own page permissions (no share-with-bot needed) | Local scripts, this skill, CLIs |
| Internal connection secret | `secret_...` / `ntn_` | Only pages/databases shared with the connection           | Team automations                |
| Public OAuth access token  | OAuth access token    | Pages chosen during install                               | Multi-workspace apps            |

Create a PAT: https://www.notion.so/developers/tokens

Create an internal connection: https://www.notion.so/my-integrations

## IDs from URLs

Notion URLs end with a 32-hex ID (often after a title slug):

```text
https://www.notion.so/My-Page-195de9221179449fab8075a27c979105
                         ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
```

Dashes in the UUID are optional in requests. The executor normalizes IDs and URLs.

## Databases vs data sources

Since 2025-09-03 / 2026-03-11:

- A **database** is a container that can have one or more **data sources**.
- Query rows with `POST /v1/data_sources/{data_source_id}/query` (not the old database query path).
- Retrieve schema with `GET /v1/data_sources/{id}`.
- `GET /v1/databases/{id}` still returns database metadata and linked data sources.

Workflow:

1. `search` or open a database URL → database ID
2. `get_database` → read `data_sources[]`
3. `get_data_source` → property schema
4. `query_data_source` → rows (pages)
5. `create_page` with `parent.data_source_id` → new row

## Common endpoints

| Method   | Path                          | Purpose                            |
|----------|-------------------------------|------------------------------------|
| GET      | `/v1/users/me`                | Token identity                     |
| POST     | `/v1/search`                  | Title search across shared content |
| GET      | `/v1/pages/{id}`              | Page properties                    |
| GET      | `/v1/pages/{id}/markdown`     | Page body as enhanced markdown     |
| POST     | `/v1/pages`                   | Create page / database row         |
| PATCH    | `/v1/pages/{id}`              | Update properties / icon / trash   |
| PATCH    | `/v1/pages/{id}/markdown`     | Edit body with markdown commands   |
| POST     | `/v1/pages/{id}/move`         | Move page                          |
| GET      | `/v1/databases/{id}`          | Database + data sources            |
| GET      | `/v1/data_sources/{id}`       | Data source schema                 |
| POST     | `/v1/data_sources/{id}/query` | Filter/sort rows                   |
| GET      | `/v1/blocks/{id}/children`    | Child blocks                       |
| PATCH    | `/v1/blocks/{id}/children`    | Append blocks                      |
| GET/POST | `/v1/comments`                | List / create comments             |
| GET      | `/v1/async_tasks/{id}`        | Poll async markdown/create jobs    |

## Search body

```json
{
  "query": "roadmap",
  "filter": {"property": "object", "value": "page"},
  "page_size": 20,
  "sort": {"timestamp": "last_edited_time", "direction": "descending"}
}
```

`filter.value` can be `"page"` or `"data_source"`. Use `filter.in_trash: true` for trash.

## Create page examples

Private workspace page (PAT / public only):

```json
{
  "icon": {"emoji": "📝"},
  "markdown": "# Notes\n\nHello from the API"
}
```

Child of a page:

```json
{
  "parent": {"type": "page_id", "page_id": "<page-id>"},
  "properties": {
    "title": [{"text": {"content": "Child page"}}]
  },
  "markdown": "## Body\n\nContent here"
}
```

Row in a data source:

```json
{
  "parent": {"type": "data_source_id", "data_source_id": "<ds-id>"},
  "properties": {
    "Name": {"title": [{"text": {"content": "New task"}}]},
    "Status": {"status": {"name": "Todo"}}
  }
}
```

## Query filters

Single condition:

```json
{
  "filter": {
    "property": "Status",
    "status": {"equals": "Done"}
  }
}
```

Compound:

```json
{
  "filter": {
    "and": [
      {"property": "Done", "checkbox": {"equals": true}},
      {
        "or": [
          {"property": "Tags", "multi_select": {"contains": "A"}},
          {"property": "Tags", "multi_select": {"contains": "B"}}
        ]
      }
    ]
  },
  "sorts": [{"property": "Due", "direction": "ascending"}],
  "page_size": 50
}
```

Common type keys: `checkbox`, `date`, `files`, `formula`, `multi_select`, `number`,
`people`, `phone_number`, `relation`, `rich_text`, `select`, `status`, `title`,
`unique_id`, `verification`.

Archived partition: top-level `"is_archived": true`.

## Pagination

List endpoints return:

```json
{
  "object": "list",
  "results": [],
  "has_more": true,
  "next_cursor": "..."
}
```

Pass `start_cursor` + `page_size` (max 100) until `has_more` is false.

Data source queries cap at ~10,000 results per filter/sort; check `request_status`.

## Rate limits

- ~3 requests/second average per connection
- Workspace-wide limits also apply
- On HTTP 429 / 529, honor `Retry-After` and back off

## Size limits (per request)

- Rich text content: 2000 chars
- URL: 2000 chars
- Arrays of blocks/rich_text: 100 items
- Payload: ~1000 blocks / 500KB

## Property types (write examples)

```json
{
  "title": [{"text": {"content": "Title"}}],
  "rich_text": [{"text": {"content": "Notes"}}],
  "number": 3,
  "select": {"name": "Option"},
  "multi_select": [{"name": "A"}, {"name": "B"}],
  "status": {"name": "In progress"},
  "date": {"start": "2026-03-11", "end": null},
  "checkbox": true,
  "url": "https://example.com",
  "email": "a@b.com",
  "phone_number": "+1 555 0100",
  "people": [{"id": "<user-id>"}],
  "relation": [{"id": "<page-id>"}]
}
```

Read-only via API (cannot set): `created_time`, `created_by`, `last_edited_time`,
`last_edited_by`, `rollup`, formula results.

## Official MCP (optional)

Hosted agent MCP (OAuth): `https://mcp.notion.com/mcp`

Tools include `notion-search`, `notion-fetch`, `notion-create-pages`,
`notion-update-page`, `notion-query-data-sources`, comments, views, users.

This skill uses the REST API with a static token instead of MCP OAuth so it works
headlessly in agent shells.

## Docs

- Index: https://developers.notion.com/llms.txt
- Intro: https://developers.notion.com/reference/intro
- Quickstart: https://developers.notion.com/guides/get-started/quick-start
- Markdown: https://developers.notion.com/guides/data-apis/enhanced-markdown
