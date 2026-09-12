# macOS App Skills

Vendored in this repo (not a git submodule). Started from [fayazara/macos-app-skills](https://github.com/fayazara/macos-app-skills) `a60365ae`, then edited for SPM menu-bar apps and Xcode `.xcodeproj` document apps.

AI coding agent skills for building, shipping, and maintaining native macOS apps with SwiftUI + AppKit.

These skills are designed for [OpenCode](https://opencode.ai), [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Cursor](https://cursor.sh), and any AI coding agent that supports skills. They encode hard-won patterns for building production macOS apps -- the kind of stuff that's underdocumented, spread across WWDC sessions, and easy to get wrong.

## Two distribution methods

Map: [`distribution.md`](distribution.md). Do not mix them in one binary.

| Method        | Gate                                 | Skills                                      |
| ------------- | ------------------------------------ | ------------------------------------------- |
| Offline       | Developer ID + `notarytool` + staple | `build/`, `release/`, `auto-update/`        |
| Mac App Store | Apple Distribution + App Review      | `app-store/`                                |

`make run` / `make install` are workflows on offline, not a third method.

## Skills

### `build/` -- Build macOS App

Build from the command line. `Package.swift` uses `swift build` plus a handmade `.app` bundle and a Makefile (`build/references/spm-app.mk`: bundle, codesign Sparkle inside-out, notary, DMG). `.xcodeproj` uses `xcodebuild` and `build/references/xcode-app.mk` (host-arch default, `make run` vs `make install`, CLI `notarytool`, iconutil Dock icns). Handles SPM arch splits, Sparkle rpath, scheme detection, beta toolchains, Swift 6 traps, and common build failures. Daily CLI ship notes: `build/references/cli-ship.md`.

### `settings-ui/` -- Settings Window with Liquid Glass

Create a proper macOS settings/preferences window with liquid glass support for macOS 26 (Tahoe). Uses `NSWindowController` with `.fullSizeContentView` for the rounded liquid glass window chrome, `NavigationSplitView` with sidebar, grouped Forms with transparent backgrounds, and back/forward toolbar navigation.

Includes complete reference Swift files you can copy into any project.

### `auto-update/` -- Sparkle Auto-Update

Add [Sparkle](https://sparkle-project.org/) auto-update support to a macOS app distributed outside the Mac App Store. Covers SPM dependency setup, the `UpdaterManager` singleton pattern, Info.plist configuration, EdDSA key generation, and UI integration (settings toggle + menu bar button). Sparkle is rejected in a Mac App Store binary (see `app-store/`).

Includes a reference `UpdaterManager.swift` ready to drop into any project.

### `macos-patterns/` -- Native Patterns for Web Developers

The "how things actually work on macOS" reference. Covers menu bar apps (MenuBarExtra vs NSStatusItem vs NSPopover), activation policy (Dock icon toggling), NSPanel vs NSWindow, window levels and collection behaviors, screen geometry (frame vs visibleFrame, Y-axis flip, multi-monitor), keyboard shortcuts (3 tiers: SwiftUI, NSEvent monitors, Carbon hotkeys), file pickers, clipboard/pasteboard, drag and drop, NavigationSplitView vs HSplitView, launch at login, Quick Look, NSWorkspace, ScreenCaptureKit, and UserDefaults/@AppStorage.

Document windows (List / VSplitView / titlebar overlay / window corners): `macos-patterns/references/swiftui-panes.md`. Settings-style column browsers stay on NavigationSplitView (see `settings-ui/`).

This is the skill to load proactively on any macOS project to prevent the AI from applying web patterns that don't work.

### `notch-ui/` -- Dynamic Island / Notch Extender

Create a Dynamic Island-style overlay that extends from the MacBook's hardware notch. Uses a borderless NSPanel at `CGShieldingWindowLevel` positioned flush against the top of the screen, with a custom `NotchShape` that has concave Bezier "ear" curves matching the hardware notch. Includes spring animations for the expand/collapse effect and a fallback pill mode for non-notch Macs.

Includes reference `NotchWindow.swift` (the panel) and `NotchShape.swift` (the shape).

### `release/` -- Offline GitHub + Sparkle

Offline / direct distribution after notarize: DMG, Sparkle `sign_update`, appcast.xml, GitHub Release. Compile and `make install` stay in `build/`. Mac App Store is `app-store/`.

Includes a **Go CLI tool** (`release/cli/`) that automates the Sparkle/DMG steps in a single command. Just add a `release.json` to your project root and run:

```bash
go run github.com/fayazara/macos-app-skills/release/cli@latest
```

### `app-store/` -- Mac App Store distribution

Method 2: App Sandbox, no Sparkle, Apple Distribution, `xcodebuild archive` + `ExportOptions.plist` (`method = app-store-connect`) + `.pkg` upload. Dual-channel (offline + store) is supported. `notarytool` never uploads to the store.

## Installation

### OpenCode (per-project)

Copy the skills you need into your project's `.agents/skills/` directory:

```bash
# Copy all skills
cp -r build settings-ui auto-update release notch-ui macos-patterns app-store /path/to/your/project/.agents/skills/

# Or just the ones you need
cp -r settings-ui /path/to/your/project/.agents/skills/
```

### OpenCode (global)

Copy into your global skills directory:

```bash
cp -r build settings-ui auto-update release notch-ui macos-patterns app-store ~/.config/opencode/skills/
```

### Other AI agents

Each skill is a self-contained directory with a `SKILL.md` file and optional `references/` folder. The `SKILL.md` is a markdown file with YAML frontmatter -- adapt to your agent's skill format.

## What These Skills Solve

Building native macOS apps with AI coding agents is great until you hit the parts where the AI confidently generates code that doesn't work:

- **Settings windows** look wrong because SwiftUI's `Window` scene doesn't support `.fullSizeContentView`, which is required for liquid glass on macOS 26
- **Sparkle integration** has subtle timing requirements (`SPUStandardUpdaterController` must be created before `applicationDidFinishLaunching` returns) that are easy to miss
- **Release pipelines** involve 8+ manual steps that are error-prone and tedious to explain every time
- **`xcodebuild`** invocations have enough flags and edge cases that the AI frequently gets them wrong. An `.xcodeproj` needs a different Makefile than SPM (`ARCHS`, not `lipo`). `make run` is the layout loop; `make install` notarizes.
- **Document panes** in `NavigationSplitView` draw under the sidebar. Workspace windows need `HSplitView`. Tahoe titlebar overlay and window-corner clipping are in `swiftui-panes.md`.
- **Dock icons** stay generic when actool writes a 16/128-only icns. `iconutil` from a full `.iconset` overwrites it.
- **Mac App Store** is a second flavor: no Sparkle, sandbox required, Apple Distribution, `.pkg` upload. `notarytool` never reaches App Store Connect.
- **Notch overlays** require specific NSPanel configuration, screen geometry math, and a custom shape with concave Bezier curves that no AI gets right from scratch
- **Native patterns** like NSPanel vs NSWindow, activation policy toggling, window levels, Carbon hotkeys, pasteboard clearing, and screen geometry have no web equivalents and the AI defaults to web-like approaches that don't work

These skills encode the correct patterns so the AI gets it right the first time.

## Requirements

- macOS 14+ (macOS 26+ for liquid glass features, with graceful fallbacks)
- Xcode 15+ (Xcode 26 beta for Tahoe SDK features)
- Swift 5.9+ (Swift 6 compile traps are listed in `build/`)

## License

MIT
