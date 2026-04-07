# Obsidian Callouts

## Syntax

```markdown
> [!type] Optional Title
> Callout content here.
> Multiple lines are supported.
```

## Foldable Callouts

```markdown
> [!note]- Collapsed by default
> Click to expand.

> [!note]+ Expanded by default
> Click to collapse.
```

## Nesting

```markdown
> [!question] Can callouts be nested?
> > [!answer] Yes! Multiple levels deep.
> > > [!tip] Even deeper nesting works.
```

## Built-in Callout Types

| Type         | Aliases                                   | Purpose                    |
|--------------|-------------------------------------------|----------------------------|
| `note`       |                                           | Default note               |
| `abstract`   | `summary`, `tldr`                         | Summary/TLDR               |
| `info`       |                                           | Informational              |
| `todo`       |                                           | Task/TODO                  |
| `tip`        | `hint`, `important`                       | Helpful tip                |
| `success`    | `check`, `done`                           | Positive outcome           |
| `question`   | `help`, `faq`                             | Question                   |
| `warning`    | `caution`, `attention`                    | Warning                    |
| `failure`    | `fail`, `missing`                         | Negative outcome           |
| `danger`     | `error`                                   | Critical warning           |
| `bug`        |                                           | Bug report                 |
| `example`    |                                           | Code/example               |
| `quote`      | `cite`                                    | Quotation                  |
| `mention`    |                                           | User mention (Obsidian Publish) |

## Custom CSS Callouts

Add custom types via CSS snippets in `.obsidian/snippets/`:

```css
.custom-snippet .callout[data-callout="custom-type"] {
    --callout-color: 200, 80, 80;
    --callout-icon: lucide-flame;
}
```

Then use: `> [!custom-type] Title`
