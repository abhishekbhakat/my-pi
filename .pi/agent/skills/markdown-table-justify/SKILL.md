---
name: markdown-table-justify
description: >-
  ASCII-justify markdown tables to target row character width (default 128).
  Use when align pipe tables for readability, fix ragged markdown tables,
  or user ask to justify/pad/format markdown tables.
---

# Markdown Table Justify

Pad pipe tables so columns line up in monospace. Each row target character width.

**Default width: 128**

## When to use

- User ask to justify, align, pad, or prettify markdown table
- Markdown must match repo ASCII-justified table style
- Clean ragged `|` tables before commit

## Slash command (no LLM)

```text
/justify path/to/file.md
/justify @.pi/agent/SYSTEM.md
/justify -w 100 README.md docs/api.md
/justify --stdout table.md
/justify README.md -o out.md
/justify --no-jev fat.md
```

Registered by extension `justify.ts`. Runs this Bun script. Zero model call
except Jev Noul when a table is over the ceiling.
Accepts Pi `@path` file refs (slash args skip the global `@` input transform).

## Script

```bash
# stdin -> stdout (width 128)
bun justify.ts < table.md

# file in place
bun justify.ts README.md

# custom width
bun justify.ts -w 100 README.md

# print only
bun justify.ts --stdout README.md

# explicit output path
bun justify.ts README.md -o out.md

# numeric peel only
bun justify.ts --no-jev fat.md
```

Run from this skill directory, or pass script path absolute:

```bash
bun /path/to/skills/markdown-table-justify/justify.ts -w 128 file.md
```

Repo path: `.pi/agent/skills/markdown-table-justify/`
Live path after install: `~/.pi/agent/skills/markdown-table-justify/`

## Rules

1. Only rewrite GFM pipe tables (header row + separator row + body).
2. Never shrink or rewrap cell text.
3. **Natural width** = sum(max cell length per column) + pipe overhead (`sum(w) + 3*n + 1`). Shortest length every row share one aligned grid (widest cells may sit on different rows).
4. **Branch A — perfect justification** (natural ≤ ceiling, default 128):
   - Column widths = per-column maxes.
   - Every row length == natural. Pipes align. No pad past content.
5. **Branch B — ceiling** (natural > 128):
   - Default: one Jev Noul per column (`col_i`). True = this col may shrink (long dump). False = keep max (short label).
   - Code peels only True cols, slackiest first, toward `hard = max(3, header)` until under ceiling.
   - No TypeSafe key / HTTP fail / `--no-jev`: numeric peel (`max` → soft median → hard).
   - Cells over final width overflow that row only.
   - If that row's content + pipes still ≤ ceiling: pad remaining columns (steal pad so the row stays ≤ ceiling; trailing `|` can line up).
   - If even raw content > ceiling: pad only until first overflow; later cells stay tight.
6. **Never inflate** table out to 128 when natural is smaller.
7. **Escaped pipes:** `\|` in cell is literal. Trailing columns with no body/header content dropped (separator `---` alone do not keep ghost column). Bare `|` in cells break GFM — use `/` or `\|`.
8. Honor separator alignment: `---` / `---:` / `:---:`.
9. Non-table markdown untouched. Re-run at same width is no-op.

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

1. Identify markdown table (file or fenced block).
2. Run `bun justify.ts` with `-w 128` unless user name another width.
3. Return or write justified table. Do not re-wrap cell text.
