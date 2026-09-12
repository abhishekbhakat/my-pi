# SwiftUI document panes

Read this before writing or fixing split views, List/ScrollView overflow, titlebar overlay, window-corner clipping, nested splitters, or Tahoe toolbar glass.

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
- Strip overlay chrome:

```swift
window.styleMask.remove(.fullSizeContentView)
window.titlebarAppearsTransparent = false
.toolbarBackground(.visible, for: .windowToolbar)
.windowToolbarStyle(.unified)
```

A one-shot `DispatchQueue.main.async` strip of `.fullSizeContentView` is not enough. Hiding `.inspector` makes SwiftUI put `.fullSizeContentView` back, and headers slide under the chrome again. Re-apply on `NSWindow.didResizeNotification`, `didBecomeKeyNotification`, and `didEndLiveResizeNotification`. Wrap `HSplitView` in a `VStack` so the split is laid out in the area below the titlebar, not as the window root.

Opaque section headers (`.background(.bar)` + `.fixedSize(horizontal: false, vertical: true)`) do not fix overlay. They only stop the header compressing to zero in a `VStack` with a `ScrollView`.

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

`doc.badge.plus` at caption size is unreadable (plus clipped on the document). Prefer a one-line status letter (`A`/`M`/`D`/`R`) plus counts. Two-line rows double list height for no gain.

## Stacked buttons

A `VStack(spacing: 0)` of `.controlSize(.large)` buttons makes Tahoe capsule radii collide. Use `spacing: 12`, the same `.buttonBorderShape(.roundedRectangle(radius: 8))` on both, `.borderedProminent` + `.bordered`.
