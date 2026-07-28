---
name: octen-search
description: >-
  USE FOR web search. Default skill whenever the user needs live web results,
  current facts, news, prices, citations, or anything after model training cutoff.
  Real-time Octen Web Search (POST /search) and Broad Search (POST /broad-search).
  Returns ranked results with highlights, optional full content, domain/time/language
  filters. Do not use monid for web search when this skill is available. Trigger on
  "search the web", "google", "look up online", "latest news", "what is the current",
  research questions needing fresh sources, or anything mentioning Octen search.
homepage: https://octen.ai
docs: https://docs.octen.ai/capabilities/web-search.md
keywords: [web search, search, octen, real-time search, web, news, research, LLM search, AI search]
---

# Octen Web Search

Default **web search** skill for this agent. Calls Octen REST directly
(not monid) via `executor.py`. Covers focused `/search` and multi-angle
`/broad-search`.

Docs index: https://docs.octen.ai/llms.txt
Capability: https://docs.octen.ai/capabilities/web-search.md
API ref: https://docs.octen.ai/api-reference/search.md

## When to use

- Ground answers on live sources (not training data)
- Fast-moving facts: prices, scores, headlines, releases
- Answers that need citations (every result has a URL)
- Open-ended multi-angle research → use **broad-search**

## Authentication

Same pattern as youtrack/notion. Precedence:

1. Environment: `OCTEN_API_KEY` (or `OCTEN_KEY`)
2. `octen-auth.json` in this skill directory (gitignored)

```bash
cp octen-auth.sample.json octen-auth.json
# put key in api_key
```

Get a key: https://octen.ai/platform/api-keys

```json
{
  "api_key": "your-octen-api-key"
}
```

**If auth is missing or any call returns 401**, stop: tell the user to add
the key, help write `octen-auth.json`, then continue. Do not retry blindly.

Verify (no network):

```bash
cd $SKILL_DIR && ./executor.py --check-auth
```

## Executor

All agent calls go through `executor.py` in this directory.

```bash
cd $SKILL_DIR
./executor.py --list
./executor.py --describe search
./executor.py --describe broad-search
./executor.py --check-auth
./executor.py --call '{"tool":"search","arguments":{"query":"latest AI research 2026","count":5}}'
./executor.py --call '{"tool":"broad-search","arguments":{"query":"compare cloud GPU pricing","max_queries":5}}'
./executor.py --call @payload.json
```

Replace `$SKILL_DIR` with this skill path (repo: `.pi/agent/skills/octen-search`,
live: `~/.pi/agent/skills/octen-search`).

## Quick Start examples

### Basic Search
```bash
./executor.py --call '{"tool":"search","arguments":{"query":"latest AI research 2026","count":5}}'
```

### Breaking news
```bash
./executor.py --call '{"tool":"search","arguments":{"query":"latest on the climate summit","topic":"news","time_range":"day"}}'
```

### Steer sources
```bash
./executor.py --call '{"tool":"search","arguments":{"query":"central bank interest rate decision","include_domains":["reuters.com","bloomberg.com"],"exclude_domains":["medium.com"],"include_text":["interest rate"],"exclude_text":["opinion"]}}'
```

### With images
```bash
./executor.py --call '{"tool":"search","arguments":{"query":"northern lights tonight","topic":"news","include_images":true}}'
```

### With Highlight and Time Filtering
```bash
./executor.py --call '{"tool":"search","arguments":{"query":"summary judgment","count":10,"time_basis":"published","start_time":"2025-01-01T00:00:00Z","end_time":"2026-01-01T00:00:00Z","highlight":{"enable":true,"max_tokens":300}}}'
```

### With Language Filtering
```bash
./executor.py --call '{"tool":"search","arguments":{"query":"climate change 2026","count":5,"language":["ja","zh"]}}'
```

### With Full Content
```bash
./executor.py --call '{"tool":"search","arguments":{"query":"latest WHO guidance on influenza vaccination","count":5,"full_content":{"enable":true,"max_tokens":1000}}}'
```

## Endpoint

```http
POST https://api.octen.ai/search
POST https://api.octen.ai/broad-search
```

Auth header is set by `executor.py` from `octen-auth.json` / `OCTEN_API_KEY`.

## Parameters

| Parameter | Type | Required | Default | Description |
|--|--|--|--|--|
| `query` | string | **Yes** | - | Search query (max 500 chars) |
| `topic` | string | No | `general` | `general` or `news` |
| `count` | integer | No | `5` | Number of results (1–100) |
| `include_domains` | string[] | No | - | Only include these domains |
| `exclude_domains` | string[] | No | - | Exclude these domains |
| `include_text` | string[] | No | - | Strings that must appear in page text (max 5, each max 30 chars) |
| `exclude_text` | string[] | No | - | Strings that must not appear (max 5, each max 30 chars) |
| `language` | string[] | No | `[]` | ISO 639-1 codes (e.g. `["en", "ja"]`). Supported: `ar`, `de`, `en`, `es`, `fr`, `hi`, `id`, `it`, `ja`, `ko`, `nl`, `pl`, `pt`, `ru`, `th`, `tr`, `vi`, `zh`. Empty = no filter |
| `time_basis` | string | No | `auto` | `auto`, `published`, or `crawled` |
| `time_range` | string | No | - | Relative window: `day`/`week`/`month`/`year` (or `d`/`w`/`m`/`y`). Mutually exclusive with `start_time`/`end_time` (absolute wins) |
| `start_time` | string | No | - | Start time filter, ISO 8601 |
| `end_time` | string | No | - | End time filter, ISO 8601 (must be after `start_time`) |
| `country` | string | No | `auto` | ISO 3166 country to prioritize |
| `highlight` | object | No | `{"enable": true}` | Highlight options (see below) |
| `format` | string | No | `text` | Highlight format: `text` or `markdown` |
| `safesearch` | string | No | `strict` | `off` or `strict` |
| `full_content` | object | No | `{"enable": false}` | Full content options (see below) |
| `include_images` | boolean | No | `false` | Include cover/in-body images per result |

### Highlight Options

| Field | Type | Default | Description |
|--|--|--|--|
| `enable` | boolean | `true` | Return query-relevant highlights in each result |
| `max_tokens` | integer | `512` | Max tokens per highlight (100–20000) |

### Full Content Options

| Field | Type | Default | Description |
|--|--|--|--|
| `enable` | boolean | `false` | Return full raw page content for each result |
| `max_tokens` | integer | `2048` | Max tokens per result (100–100000) |

## Response Format

### Response Fields

| Field | Type | Description |
|--|--|--|
| `code` | integer | Status code. `0` = success |
| `msg` | string | Human-readable status message |
| `request_id` | string | Unique request identifier |
| `data.query` | string | The original query |
| `data.results[]` | array | List of search results |
| `data.results[].title` | string | Page title |
| `data.results[].url` | string | Page URL |
| `data.results[].highlight` | string? | Query-relevant snippets (when `highlight.enable` is true) |
| `data.results[].full_content` | string? | Full page content (when `full_content.enable` is true) |
| `data.results[].authors` | string? | Website name or author |
| `data.results[].time_published` | string? | Publish time, ISO 8601 |
| `data.results[].time_last_crawled` | string? | Last crawl time, ISO 8601 |
| `meta.usage.num_search_queries` | integer | Number of search queries executed |
| `meta.usage.full_content_tokens` | integer | Total tokens returned in full_content |
| `meta.latency` | number | Response time in milliseconds |
| `meta.warning` | string? | Warning message, if any |

### JSON Example

```json
{
  "code": 0,
  "msg": "success",
  "request_id": "req_abc123def456",
  "data": {
    "query": "latest WHO guidance on influenza vaccination",
    "results": [
      {
        "title": "Influenza (Seasonal) - World Health Organization (WHO)",
        "url": "https://www.who.int/news-room/fact-sheets/detail/influenza-(seasonal)",
        "highlight": "WHO recommends annual vaccination for high-risk groups\n\n...\n\nSeasonal influenza vaccination policies vary by region...",
        "authors": "World Health Organization",
        "time_published": "2024-10-15T00:00:00Z",
        "time_last_crawled": "2026-01-20T02:12:34Z"
      }
    ]
  },
  "meta": {
    "usage": {
      "num_search_queries": 1,
      "full_content_tokens": 0
    },
    "latency": 237,
    "warning": null
  }
}
```

## Broad Search

**Broad Search** expands your query into several related sub-queries from
different angles, searches them concurrently, and returns results **grouped per
sub-query** (not deduplicated across groups) — ready to ground a complete answer.

**Use it when** a single `/search` only reaches a few of the relevant subtopics:
- **Comparisons** across many sources (pricing, products, vendors)
- **Surveys / deeper research**
- **Multi-angle questions** that have more than one facet

For a single focused lookup, use plain `/search` instead.

**Pass the original query as-is** — Octen generates the sub-queries for you, so
do **not** rewrite or pre-split the question into multiple calls; to widen
coverage, raise `max_queries` (default `5`; up to `30` for surveys/research,
lower for a tighter search).

### Endpoint

```http
POST https://api.octen.ai/broad-search
```

### Example

```bash
./executor.py --call '{"tool":"broad-search","arguments":{"query":"compare cloud GPU pricing across major providers","max_queries":5,"search_options":{"count":10,"highlight":{"enable":true}}}}'
```

### Parameters

| Parameter | Type | Required | Default | Description |
|--|--|--|--|--|
| `query` | string | **Yes** | - | Original search query (max 500 chars) |
| `max_queries` | integer | No | `5` | Upper bound on the number of sub-queries generated (1–30); raise toward 30 for surveys/research, lower for a tighter search |
| `search_options` | object | No | - | Options applied to **each** sub-query — same fields and defaults as the [Parameters](#parameters) table above (`topic`, `count`, `include_domains`, `language`, time filters, `highlight`, `full_content`, `include_images`, …) |

### Response

Same envelope (`code`, `msg`, `request_id`, `meta`) as Search. `data` contains:

| Field | Type | Description |
|--|--|--|
| `data.query` | string | The original query |
| `data.queries[]` | string[] | The generated sub-queries |
| `data.search_results[]` | array | One result group per sub-query |
| `data.search_results[].query` | string | The sub-query for this group |
| `data.search_results[].results[]` | array | Results for that sub-query (same shape as Search `data.results[]`) |
| `data.search_results[].latency` | integer | Latency for that sub-query, in milliseconds |

## Error Codes

| HTTP Status | Description |
|--|--|
| `400` | Missing or invalid parameter |
| `401` | Invalid or missing API key |
| `403` | Insufficient balance |
| `429` | Rate limited |
| `500` | Internal server error |

## Security

- `octen-auth.json` is gitignored (same as youtrack/notion auth files)
- Key is sent only to `https://api.octen.ai/*` via HTTPS as `X-Api-Key`
- Prefer `octen-auth.json` over shell exports so pi sessions pick it up without profile hacks

## Agent rules

1. Prefer this skill over monid/generic fetch for web search.
2. Always use `./executor.py` (not raw curl) so auth resolution stays consistent.
3. Default to `search` with small `count` (5–10). Use `broad-search` only for multi-angle/comparison/research questions.
4. Cite source URLs from results in the answer.
5. Enable `full_content` only when highlights are not enough (costs more tokens).
6. On `401`/`403`, stop and tell the user — do not spam retries.

## Notes

- **Highlight** on by default — `"highlight": {"enable": false}` to disable
- **Full content** off by default — enable for RAG/grounding
- `include_domains` / `exclude_domains` to scope sources
- `language` (ISO 639-1) filters language — on Broad Search put it inside `search_options`
- `time_range` for relative windows; or `start_time`/`end_time` + `time_basis`
- `format: "markdown"` vs `"text"` for highlights
- Cost: about $1 per 1,000 search calls (full_content billed extra by tokens)
