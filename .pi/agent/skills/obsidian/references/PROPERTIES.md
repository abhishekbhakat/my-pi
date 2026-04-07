# Obsidian Properties (Frontmatter)

## Syntax

YAML frontmatter delimited by `---` at the very top of the file:

```yaml
---
title: My Note
date: 2024-01-15
tags:
  - project
  - active
aliases:
  - Alternative Name
  - Alt
cssclasses:
  - custom-class
---
```

## Built-in Properties

| Property     | Type         | Description                                              |
|--------------|--------------|----------------------------------------------------------|
| `tags`       | list/string  | Searchable labels. Also addable inline with `#tag`.      |
| `aliases`    | list/string  | Alternative note names. Used in link suggestions.        |
| `cssclasses` | list/string  | CSS class(es) applied to the note for custom styling.    |

## Custom Properties

Any key-value pair is valid. Common patterns:

```yaml
---
status: in-progress
priority: high
date: 2024-01-15
type: reference
related:
  - "[[Other Note]]"
---
```

Values can be strings, numbers, booleans, dates, lists, or YAML `[[wikilinks]]`.

## Tag Rules

- Letters, numbers (not first char), underscores, hyphens, forward slashes.
- Nested hierarchy with `/`: `#project/active`, `#personal/finance`.
- Can be set in frontmatter `tags:` array OR inline with `#tag` in body.
- Frontmatter tags are searchable and appear in the tag pane.

## Aliases Rules

- Used by Obsidian's link suggestion to match alternative names.
- Useful for abbreviations, alternate spellings, or shortened names.
