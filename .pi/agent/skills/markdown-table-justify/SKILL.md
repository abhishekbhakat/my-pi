---
name: markdown-table-justify
description: >-
  ASCII-justify markdown tables to a target row character width (default 128).
  Use when aligning pipe tables for readability, fixing ragged markdown tables,
  or when the user asks to justify/pad/format markdown tables.
---

# Markdown Table Justify

Pad pipe tables so columns line up in monospace and each row targets a character width.

**Default width: 128**

## When to use

- User asks to justify, align, pad, or prettify a markdown table
- Writing markdown that should match the repo's ASCII-justified table style
- Cleaning ragged `|` tables before commit

## Script

```bash
# stdin -> stdout (width 128)
uv run justify.py < table.md

# file in place
uv run justify.py README.md

# custom width
uv run justify.py -w 100 README.md

# print only
uv run justify.py --stdout README.md

# explicit output path
uv run justify.py README.md -o out.md
```

Run from this skill directory, or pass the script path absolutely:

```bash
uv run /path/to/skills/markdown-table-justify/justify.py -w 128 file.md
```

Repo path: `.pi/agent/skills/markdown-table-justify/`  
Live path after install: `~/.pi/agent/skills/markdown-table-justify/`

## Rules

1. Only rewrite GFM pipe tables (header row + separator row + body).
2. Never shrink or rewrap cell text.
3. **Natural width** = sum(max cell length per column) + pipe overhead (`sum(w) + 3*n + 1`). This is the shortest length where every row can share one aligned grid (widest cells may sit on different rows).
4. **Branch A — perfect justification** (natural ≤ ceiling, default 128):
   - Column widths = per-column maxes.
   - Every row length == natural. Pipes align. No pad past content.
5. **Branch B — ceiling** (natural > 128):
   - Start from **column maxes**, peel toward `soft = max(3, header, median)` then `hard = max(3, header)` until under ceiling.
   - Peel the slackiest column first so short label cols keep their max (e.g. Doctype fits `**judgment**`) and long text cols take the cut.
   - Cells still over the final width overflow that row only.
   - Pad columns before the first overflow; content-tight from the overflow onward.
6. **Never inflate** a table out to 128 when natural is smaller.
7. **Escaped pipes:** `\|` in a cell is literal. Trailing columns with no body/header content are dropped (separator `---` alone does not keep a ghost column). Bare `|` in cells still breaks GFM — use `/` or `\|`.
8. Honor separator alignment: `---` / `---:` / `:---:`.
9. Non-table markdown untouched. Re-run at same width is a no-op.

## Example

Input:

```markdown
| Name | Age |
| --- | ---: |
| Abhishek | 30 |
| Sam | 4 |
```

Output at `-w 40`:

```markdown
| Name          | Age |
| ------------- | --: |
| Abhishek      |  30 |
| Sam           |   4 |
```

## Agent workflow

1. Identify the markdown table (file or fenced block).
2. Run `justify.py` with `-w 128` unless the user names another width.
3. Return or write the justified table. Do not re-wrap cell text.
