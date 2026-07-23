# Notion enhanced markdown

Used by:

- `POST /v1/pages` with `markdown`
- `GET /v1/pages/{id}/markdown`
- `PATCH /v1/pages/{id}/markdown`

Prefer markdown tools over raw block trees when creating or editing page content.

## Indentation

Use **tabs** for nested children. One tab deeper than the parent.

## Block types

```markdown
# Heading 1 {color="blue"}
## Heading 2
### Heading 3

Paragraph text {color="gray"}

- Bulleted item
	Nested child
1. Numbered item

- [ ] Unchecked todo
- [x] Checked todo

> Quote line<br>Second line

---

```python
print("code")
```

$$
E = mc^2
$$
```

### Toggle

```html
<details color="gray_bg">
<summary>Toggle title</summary>
	Child content
</details>
```

Toggle heading:

```markdown
# Section {toggle="true"}
	Hidden children
```

### Callout

```html
<callout icon="💡" color="blue_bg">
	Callout body with **bold** text
</callout>
```

### Table

```html
<table header-row="true">
	<tr>
		<td>Col A</td>
		<td>Col B</td>
	</tr>
	<tr>
		<td>1</td>
		<td>2</td>
	</tr>
</table>
```

### Columns

```html
<columns>
	<column>
		Left
	</column>
	<column>
		Right
	</column>
</columns>
```

### Media

```markdown
![Caption](https://example.com/image.png)
```

```html
<audio src="URL">Caption</audio>
<video src="URL">Caption</video>
<file src="URL">Caption</file>
<pdf src="URL">Caption</pdf>
```

### Empty line

```html
<empty-block/>
```

Plain empty lines are stripped. Use `<empty-block/>` for intentional blank blocks.

## Inline formatting

| Format        | Syntax                               |
|---------------|--------------------------------------|
| Bold          | `**text**`                           |
| Italic        | `*text*`                             |
| Strikethrough | `~~text~~`                           |
| Underline     | `<span underline="true">text</span>` |
| Inline code   | `` `code` ``                         |
| Link          | `[text](URL)`                        |
| Inline math   | `$equation$`                         |
| Line break    | `<br>`                               |
| Color         | `<span color="red">text</span>`      |

### Mentions

```html
<mention-user url="URL">Name</mention-user>
<mention-page url="URL">Title</mention-page>
<mention-database url="URL">DB</mention-database>
<mention-data-source url="URL">Source</mention-data-source>
<mention-date start="2026-03-11"/>
```

## Colors

Text: `gray`, `brown`, `orange`, `yellow`, `green`, `blue`, `purple`, `pink`, `red`

Background: `gray_bg`, `brown_bg`, `orange_bg`, `yellow_bg`, `green_bg`, `blue_bg`, `purple_bg`, `pink_bg`, `red_bg`

Block color attribute: `{color="blue"}` on the first line of a block.

## Escaping

Outside code blocks escape: `\ * ~ \` $ [ ] < > { } | ^`

Do not escape inside fenced code blocks.

## Markdown update commands

### `update_content` (preferred for edits)

API body (flat `type` + payload):

```json
{
  "type": "update_content",
  "update_content": {
    "content_updates": [
      {"old_str": "old text", "new_str": "new text"},
      {"old_str": "everywhere", "new_str": "here", "replace_all_matches": true}
    ]
  }
}
```

Executor accepts `content_updates` (or alias `operations`) with `command: "update_content"`.

### `replace_content`

Replace entire page body:

```json
{
  "type": "replace_content",
  "replace_content": {
    "new_str": "# New page\n\nFull replacement body"
  }
}
```

### Protecting nested pages

By default, operations that would delete child pages/databases fail. Pass
`allow_deleting_content: true` only when intentional.

## JSON newlines

In JSON, encode newlines as `\n`. When using shell JSON, wrap the payload in single quotes so `\n` survives.
