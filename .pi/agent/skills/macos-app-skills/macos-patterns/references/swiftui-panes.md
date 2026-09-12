# SwiftUI document panes

Read this before writing or fixing split views, List/ScrollView overflow, titlebar overlay, window-corner clipping, nested splitters, Tahoe toolbar glass, file trees, sibling headers, or diff/code panes.

`NavigationSplitView` + `.inspector` is for Settings-style column browsers. A document window with a persistent sidebar plus a `List` / `VSplitView` / diff pane uses `HSplitView`.

## Detail panes must not size to content

Views that size to content grow the window or paint under chrome.

- Put `List` and diff `ScrollView` inside a parent with a finite height. `VSplitView` / `HSplitView` children need `.frame(minHeight: N, maxHeight: .infinity)` and `.clipped()`.
- Do not nest `NavigationSplitView` inside an inspector or inside another split. Use `HStack` + fixed column width, or one `HSplitView`.
- `ScrollView { LazyVStack { ForEach(lines) } }` reports the height of every line. Wrap it in `GeometryReader` and `.frame(maxWidth: .infinity, maxHeight: .infinity)`.
- `Text` with `.lineLimit(1)` still proposes the full line width. Set `.frame(minWidth: 0, maxWidth: .infinity)` or the pane grows with the longest diff line.
- `.windowResizability(.contentMinSize)` makes the window follow that huge min size. Use `.automatic` and clip the content to the user's frame.
- Do not change chrome when selection changes. A multi-file diff (`HSplitView` + file list) switching to a single-file full-width viewer on click jumps the layout. Keep one layout; pass `selectedPath`.

Commit / Stash pattern that holds:

```swift
VSplitView {
    top.frame(minHeight: 140, maxHeight: .infinity).clipped()
    diff.frame(minHeight: 120, maxHeight: .infinity).clipped()
}
.frame(maxWidth: .infinity, maxHeight: .infinity)
.clipped()
```

Inspector `min: 260, ideal: 320, max: 480` plus sidebar width, plus a 240pt message column, leaves little for file lists. Those lists must shrink (`minWidth: 0`), not push the window.

## Do not put document panes in NavigationSplitView detail

On macOS, `NavigationSplitView` draws the **detail at window x = 0** and overlays the sidebar. Detail content starts under the sidebar. Hide the sidebar and the overlap disappears. That is not missing leading padding in the child view.

Two failed compensations:

1. `GeometryReader` in the detail view reports **full window width**. Setting `.frame(width: geo.size.width)` while the view is already placed in the visible detail strip makes the pane one sidebar too wide. Extra width shows up as empty space on the right. Hide sidebar, right gap gone.
2. Dropping the `GeometryReader` and using `maxWidth: .infinity` puts you back to origin underflow: lists and diffs sit under the sidebar again.

Leading-padding the child by sidebar width breaks when the user resizes the sidebar.

What works: replace the shell with `HSplitView`. Sidebar and detail each get a real proposed size.

```swift
HSplitView {
    RepoSidebarView(...)
        .frame(minWidth: 180, idealWidth: 220, maxWidth: 280)
    VStack(spacing: 0) {
        banner
        detail
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    .frame(minWidth: 420, maxWidth: .infinity, maxHeight: .infinity)
    .clipped()
}
.inspector(isPresented: $showInspector) { ... }
```

Keep `.inspector` on that `HSplitView`. Do not nest `NavigationSplitView` inside it.

Use `NavigationSplitView` for Settings-style column browsers. Use `HSplitView` for a persistent workspace sidebar plus a `List` / `VSplitView` document pane.

## Unified titlebar overlays HSplitView content

Symptom: section headers (and the first tree rows) sit under the window chrome. Sidebar list is inset correctly. Window title truncates in the sidebar slot. Right toolbar icons sit on the detail. Dragging a splitter briefly relayouts the overlap.

Cause: `.toolbar` + `.navigationTitle` on the **detail** column of `HSplitView`. macOS 26 puts `.fullSizeContentView` on the window, so the detail draws from y = 0 under the titlebar. Sidebar `List` respects the top safe area; `HSplitView` detail does not. The title also binds to the sidebar column width, so it clips against traffic lights + refresh.

What does not fix it: swapping `List` for `ScrollView`, dropping `DisclosureGroup`, `safeAreaInset` on the file list, `maxHeight: .infinity` on the scroll view.

What works:

- Put `.navigationTitle`, `.navigationSubtitle`, and `.toolbar` on the **outer** `HSplitView`, not the detail `VStack`.
- Do not set `.navigationTitle` on the sidebar `List` (that pins the title to the sidebar slot).
- Left: app name (`navigationTitle`). Center: document (`.principal` + `navigationSubtitle`). Right: `ToolbarItemGroup(placement: .primaryAction)` so icons keep a fixed trailing cluster.
- Do not put a lone refresh in `ToolbarItem(placement: .navigation)`. `.navigation` is for back/leading chrome. A single control next to the traffic lights looks stranded. Icon actions go in the right cluster.
- Strip overlay chrome:

```swift
window.styleMask.remove(.fullSizeContentView)
window.titlebarAppearsTransparent = false
.toolbarBackground(.visible, for: .windowToolbar)
.windowToolbarStyle(.unified)
```

A one-shot `DispatchQueue.main.async` strip of `.fullSizeContentView` is not enough. Hiding `.inspector` makes SwiftUI put `.fullSizeContentView` back, and headers slide under the chrome again. Re-apply on `NSWindow.didResizeNotification`, `didBecomeKeyNotification`, and `didEndLiveResizeNotification`. Wrap `HSplitView` in a `VStack` so the split is laid out in the area below the titlebar, not as the window root.

Opaque section headers (`.background(.bar)` + `.fixedSize(horizontal: false, vertical: true)`) do not fix overlay. They only stop the header compressing to zero in a `VStack` with a `ScrollView`.

## List + DisclosureGroup clips the first row

macOS `List` + `DisclosureGroup` clips or skips the first row. A staged/unstaged file tree looks empty at the top even when the model has files.

This is a separate bug from titlebar overlay. Dropping `DisclosureGroup` does not fix overlay; overlay can be correct and the first tree row still missing.

Build the tree with `ScrollView` + indented `HStack` rows and a chevron `Button`. Leave `List` and `DisclosureGroup` out of document file trees.

## ScrollView maxHeight covers the sibling header

In a `VStack` (Unstaged / Staged stacks), `ScrollView { ... }.frame(maxHeight: .infinity)` takes the rest of the stack and paints over the section header.

- Header: `.layoutPriority(1)` + `.fixedSize(horizontal: false, vertical: true)` + `.background(.bar)`.
- ScrollView: `.frame(minHeight: 0)` so it can shrink. `maxHeight: .infinity` on that scroll view is what hides the header.

`VSplitView` `minHeight` / `.clipped()` on the pane is a different layer. This is sibling layout inside one pane. Titlebar overlay is a third layer.

## Window corner inset is points from the window radius

Symptom: last lines hide under the bottom-trailing rounded corner (Tahoe).

Wrong fix: `padding(.bottom, 18)` / `padding(.trailing, 12)`. SwiftUI padding is already **points**. Retina `backingScaleFactor` (2x/3x) converts points to pixels. Multiplying by scaleFactor double-pads on a 2x display. Screen resolution is not the variable.

The variable is **that window's corner radius**. Tahoe uses more than one (toolbar windows get a larger radius than plain windows; scroll bars of a root scroller get cut off). Sources: [lapcatsoftware.com/articles/2026/3/1.html](https://lapcatsoftware.com/articles/2026/3/1.html), [mjtsai.com Tahoe Window Corners](https://mjtsai.com/blog/2025/10/16/tahoe-window-corners/).

What to do:

- Read radius from the window layer tree (`contentView` walking `superview.layer.cornerRadius`). Fallback: 26pt if macOS 26 + toolbar, else 12pt / 10pt. Do not use private `value(forKey: "cornerRadius")`.
- Publish it with `EnvironmentValues.windowCornerRadius`.
- Do **not** pad a square. That leaves a sharp inner rect that does not follow the window curve. Clip with `UnevenRoundedRectangle(..., style: .continuous)` using the window radius on the matching corner (`bottomTrailing` for a diff, extra bottom clearance on the sidebar path).
- Still add scroll-content padding of `~0.45*R` so the last line can sit above the curve.
- Apple’s `ConcentricRectangle` / container-relative corners (iOS 26 / macOS 26) match a parent shape. Use that for nested chrome. For a `ScrollView` inside `HSplitView`/`VSplitView` (those ignore safe area), clip + scroll clearance from the window radius still wins.

```swift
func windowCornerRadius(from window: NSWindow) -> CGFloat {
    var view: NSView? = window.contentView
    while let current = view {
        if let radius = current.layer?.cornerRadius, radius > 0 {
            return radius
        }
        view = current.superview
    }
    if #available(macOS 26, *) {
        return window.toolbar != nil ? 26 : 12
    }
    return 10
}
```

## Inspector only when it has content

A persistent `.inspector` on every section is empty on some pages and wastes 260–480pt. Bind `isPresented` to the section that actually has inspector content. Hide the toolbar toggle elsewhere. Prefer putting related info under the grid, not a sticky right column, when the Windows/source app did that.

`.inspector` centers a hugging child. `ContentUnavailableView` plus a `VStack` that does not fill height puts the tab picker in the vertical middle. Pin:

```swift
VStack(spacing: 0) {
    picker
    Divider()
    body
}
.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
```

Empty copy is a leading `Text` with `.secondary` and `.topLeading`, not `ContentUnavailableView`.

A master-detail `DiffView` (file list + patch, min ~160 + 240) does not fit `.inspectorColumnWidth(max: 400)`. It grows the column, clips chrome (`View` to `iew`), and leaves a sliver of patch. Inspector Diff tab: stacked patches or an `NSTextView`. File list stays on the Files tab. Do not embed the commit `DiffView` in the inspector.

`.onDrag` without `preview:` lifts the whole row, including status labels. Put the drag on the letter+filename cluster and pass a compact `preview:`.

## Nested HSplitView has no resize cursor

An `HSplitView` inside a `VSplitView` does not show `NSCursor.resizeLeftRight` on hover. The divider still drags if the user finds it. Users report it as not adjustable.

Do not nest `HSplitView` for that pane. Use `HStack` + a 6pt handle:

```swift
.onHover { hovering in
    if hovering { NSCursor.resizeLeftRight.set() } else { NSCursor.arrow.set() }
}
// DragGesture: store origin on first change, width = clamp(origin + translation.width)
```

Use `set()`, not `push()`/`pop()`. If the view disappears mid-hover, `pop()` leaves a stuck resize cursor.

Default width is not `180`. Measure the longest filename + extra columns with `NSString.size(withAttributes:)` and `NSFont` (points). Clamp 160–480.

Adjustable columns belong in `HSplitView` only at the **window** shell. Inside `VSplitView`, use this custom handle.

## Tahoe toolbar glass crushes wide items

`ToolbarItemGroup` wraps each child in a circular glass control. A badge of `arrow.down.circle` + `0` + `arrow.up.circle` + `0` is stuffed into one circle; the digits sit outside the glyph.

- Keep icon-only buttons in the group.
- Put the badge in its **own** `ToolbarItem`.
- Draw a capsule: `↓ N  ↑ N` (simple arrows, not circle SF Symbols). Do not use `arrow.down.circle` inside a circular toolbar button.
- `.sharedBackgroundVisibility(.hidden)` is `ToolbarContent`, not `View`. Putting it on the badge view does nothing; the circular glass still clips `↓ N ↑ N`. Apply it on the `ToolbarItem` that owns the capsule.

`doc.badge.plus` at caption size is unreadable (plus clipped on the document). Prefer a one-line status letter (`A`/`M`/`D`/`R`) plus counts. Two-line rows double list height for no gain.

`checkmark.circle` as Commit reads as done/OK. Hover help (`Commit ⇧⌘C`) is not enough if the glyph is the wrong verb. Pick a glyph that names the action, or show the word.

## Stacked buttons

A `VStack(spacing: 0)` of `.controlSize(.large)` buttons makes Tahoe capsule radii collide. Use `spacing: 12`, the same `.buttonBorderShape(.roundedRectangle(radius: 8))` on both, `.borderedProminent` + `.bordered`.

## Click-select vs double-click-open

Finder behavior: single click highlights, double click / Return / Space opens.

What fails:

- Two `List`s sharing one `selection` binding. Highlight is tied to which list is first responder. The other list stays blank.
- `.focusable()` on a parent of `List`. The parent takes first responder. The list never draws the selected row.
- `onTapGesture(count: 2)` on the row. SwiftUI waits for the double-tap timeout and often never delivers the click to `List` selection.

What works: drop `List` selection. `ScrollView` + `ForEach`. Paint the row with `Color.accentColor.opacity(0.28)` when `selectedPath == path`. Single `onTapGesture` sets `selectedPath`. `simultaneousGesture(TapGesture(count: 2))` opens. `@FocusState` on that pane, set true in the tap. `.onKeyPress(.return)` and `.onKeyPress(.space)` open `selectedPath`.

## Diff / code panes: semantic green and red look like a different font

Symptom: unified-diff add and remove lines look heavier, thinner, or a different typeface than context lines, even when the `HStack` already has `.font(.mono(11))`.

Cause: `.foregroundStyle(Color.green)` / `Color.red` (system, vibrant) on Tahoe dark chrome changes optical size and weight. SwiftUI `.system(size:weight:design: .monospaced)` plus a semantic color can pick a different optical size than `.primary` context.

What works:

- Pin the face: `Font(NSFont.monospacedSystemFont(ofSize:weight:))`.
- Code stays `.primary`, same as context.
- Color only the leading `+` / `-` and the background wash (`Color.green.opacity(0.12)` / `Color.red.opacity(0.12)`).
- Read `@AppStorage("diffFontSize")` into that NSFont size. A Settings slider that the diff view ignores is dead.

Xcode and VS Code keep editor foreground on the code and tint the wash + prefix.

### Per-line SwiftUI diffs hitch

A stacked commit patch (`ForEach` of per-line `HStack`s plus nested `ScrollView(.vertical)` / `ScrollView(.horizontal)` and `.fixedSize`) lays out every line up front. A `project.pbxproj` commit freezes scroll. SwiftUI `ScrollView([.vertical, .horizontal])` hides the horizontal bar on Tahoe overlay scrollers.

Use one `NSScrollView` + `NSTextView`:

- `hasVerticalScroller` / `hasHorizontalScroller` = true, `autohidesScrollers` = false, `scrollerStyle = .legacy`
- `isHorizontallyResizable = true`
- `textContainer?.widthTracksTextView = false`
- `containerSize.width = CGFloat.greatestFiniteMagnitude`
- `NSParagraphStyle.lineBreakMode = .byClipping`
- One `NSAttributedString` (header, cyan hunk line, green/red wash). Rebuild only when the diff string or font size changes.

### `fixedSize(vertical: false)` opens a hole under the first file

`LazyVStack` as the first child of a scroll view gets the viewport height as its proposal. `.fixedSize(horizontal: true, vertical: false)` accepts that height. The first file header sits at the top, then a blank band, then the patch.

Hug the patch: `.fixedSize(horizontal: true, vertical: true)` on the line stack, `.fixedSize(horizontal: false, vertical: true)` on each file block. Prefer `VStack` over `LazyVStack` for the file list when an `NSTextView` is not in play yet.

### Side-by-side columns hug per row

`HStack { leftCell; rightCell }` with `.fixedSize(horizontal: true)` on the code `Text` sizes each row to that line. Left column width then changes every row. Columns zigzag, overlap, and paint over the file header.

Give both panes one shared width: `NSStackView` `distribution = .fillEqually`, or `.frame(width: col)` on both cells. Do not let a `SideCell` hug.

### NSSplitView inside NSViewRepresentable

`NSSplitView` plus `setPosition(bounds.width / 2, ofDividerAt: 0)` in `updateNSView` runs at width 0. A `didSplit` flag then skips later layout. The right pane is a sliver (a few pixels of wash plus a scrollbar).

Use `NSStackView` (horizontal, `fillEqually`, spacing 1). It fills the representable frame. Nested `NSSplitView` also fights a parent SwiftUI `HSplitView` / `VSplitView`.

### Representable with no height

A bare `NSView` plus Auto Layout subviews reports no intrinsic height. SwiftUI `VStack` (file header, then representable) hugs the representable to overlay-scroller height. Two horizontal scrollbars sit on the header. The pane below is empty.

Return `NSStackView` from `makeNSView`. Set hugging and vertical compression resistance to `.defaultLow` on the stack and both `NSScrollView`s. Implement `sizeThatFits` and return the proposal (`max(proposal.height ?? 240, 120)`). Put `.frame(maxWidth: .infinity, maxHeight: .infinity)` on the SwiftUI wrapper. Put `Int(bounds.width)xInt(bounds.height)` in the render key so `updateNSView` reapplies after the view leaves 0x0.

### Synced scroll on two NSScrollViews

`contentView.postsBoundsChangedNotifications = true`. Observe `NSView.boundsDidChangeNotification` on both clip views. Copy `from.contentView.bounds.origin` onto `to`, then `reflectScrolledClipView`. A `syncing` flag stops the echo.

Vertical only: keep `to`'s x, copy y. Both axes: copy the full origin. AppKit clamps when one document is shorter.

Pair add/delete rows (blank line on the other side) and set both document views to `max(leftHeight, rightHeight)`. Otherwise Y positions drift.

### Colored +/- rows look padded

`NSAttributedString` `.backgroundColor` on add/remove lines plus default font leading makes those rows taller than context.

Set `text.layoutManager?.usesFontLeading = false` in `makeNSView`. Paragraph style: `lineSpacing = 0`, `paragraphSpacing = 0`, `paragraphSpacingBefore = 0`, `lineHeightMultiple = 1`, `minimumLineHeight = maximumLineHeight = ceil(font.ascender - font.descender)`.
