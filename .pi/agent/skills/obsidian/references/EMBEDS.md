# Obsidian Embeds

## Syntax

Prefix any wikilink with `!` to embed content inline:

```markdown
![[Note Name]]                         Embed full note content
![[Note Name#Heading]]                 Embed a specific section
![[Note Name#^block-id]]               Embed a specific block
![[image.png]]                         Embed image
![[image.png|300]]                     Embed image with width in pixels
![[image.png|300x200]]                 Embed image with width x height
![[document.pdf]]                      Embed PDF (first page)
![[document.pdf#page=3]]               Embed specific PDF page
![[audio.mp3]]                         Embed audio player
![[video.mp4]]                         Embed video player
```

## External Images

Standard markdown syntax for external URLs (not embedded in vault):

```markdown
![alt text](https://example.com/image.png)
![alt text|300](https://example.com/image.png)
```

## Search Embeds

Embed the results of a search query:

```markdown
![[search query:"tag:#project"]]
```

## Notes

- Embeds are live -- if the source note changes, the embed updates.
- Embedded notes are read-only in the embed context.
- Use `|width` after the filename to resize images.
