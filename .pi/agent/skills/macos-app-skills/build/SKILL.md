---
name: macos-build
description: >
  Build a native macOS app from the command line. Prefer Swift Package Manager (`swift build`)
  when Package.swift exists; use xcodebuild only for .xcodeproj/.xcworkspace. Use when the user
  asks to build, compile, assemble an .app bundle without Xcode, fix Gradle-like path issues for
  Swift/macOS, or says "does it compile", "swift build", "xcodebuild", "build the app",
  "make run", "make install", "notarize", or "Dock icon". Also use for arch-specific release
  binaries (arm64/x86_64), homemade .app layout, an Xcode Makefile (host-arch default, CLI
  notarytool, install to /Applications), iconutil Dock icns, and Swift 6 compile traps.
  Offline / direct distribution (Developer ID + notarize): this skill plus macos-release.
  Mac App Store: macos-app-store. Do not mix the two methods.
---

# Build macOS App

Two distribution methods. Read `../distribution.md` before signing or shipping.

| Method        | Gate                                 | This skill                         |
| ------------- | ------------------------------------ | ---------------------------------- |
| Offline       | Developer ID + `notarytool` + staple | compile, `make run`, notarize      |
| Mac App Store | Apple Distribution + App Review      | none. Use macos-app-store.         |

Sparkle + GitHub + DMG is still offline. That is macos-release. `make install` is a workflow on offline, not a third method.

Detect the project kind first. Many menu-bar apps are SPM executables with no Xcode project.

```bash
ls Package.swift *.xcodeproj *.xcworkspace 2>/dev/null
```

If `Package.swift` exists, use SPM. Use `xcodebuild` only when an `.xcodeproj` or `.xcworkspace` is the source of truth.

## Swift Package Manager

```bash
swift build
swift build -c release
swift build -c release --arch arm64
swift build -c release --arch x86_64
```

Binaries land in `.build/debug/<Name>` or `.build/release/<Name>` (arch-specific dirs for `--arch x86_64`).

`Package.swift` for an AppKit/SwiftUI app is an `.executableTarget`, not an iOS-style app target. Link system frameworks and Sparkle rpath:

```swift
.executableTarget(
    name: "MyApp",
    dependencies: ["Sparkle"],
    path: "Sources/MyApp",
    resources: [.process("Resources")],
    linkerSettings: [
        .linkedFramework("AppKit"),
        .linkedFramework("SwiftUI"),
        .unsafeFlags(["-Xlinker", "-rpath", "-Xlinker", "@executable_path/../Frameworks"])
    ]
)
```

SPM does not emit a `.app`. After `swift build -c release`, assemble:

```text
MyApp.app/Contents/MacOS/MyApp          # the executable
MyApp.app/Contents/Info.plist
MyApp.app/Contents/Resources/            # copied SPM resources / icons
MyApp.app/Contents/Frameworks/Sparkle.framework
MyApp.app/Contents/embedded.provisionprofile  # if needed
```

Sparkle from SPM lives under `.build/artifacts/sparkle/Sparkle/.../Sparkle.framework`. Copy that into `Contents/Frameworks`. Sign the nested framework, then the app, with the same Developer ID.

Format Swift with `swiftformat Sources/` or `swift-format` when present.

## Makefile for SPM apps

If the project has `Package.swift` and no Xcode project, add a root `Makefile`. Do not invent `xcodebuild` archive targets.

Copy `build/references/spm-app.mk` to the repo as `Makefile`, then set:

- `PROJECT_NAME`, `BUNDLE_ID`, `TEAM_ID`
- `ENTITLEMENTS`, `INFO_PLIST`, `MACOSX_DEPLOYMENT_TARGET`
- `RESOURCES_DIR`, `APP_ICON`

Pipeline (same as a menu-bar SPM app):

1. `swift build` / `swift build -c release --arch arm64|x86_64`
2. `lipo -create` for universal
3. Assemble `Contents/MacOS`, `Info.plist`, Resources, Sparkle.framework
4. Sign Sparkle XPC/Autoupdate/Updater.app/framework, then the `.app` with `--options runtime` and entitlements
5. Zip, `notarytool submit --wait`, `stapler staple`, re-zip
6. `create-dmg` or `hdiutil`; `sign_update` from Sparkle SPM `bin/`

Daily targets: `make build`, `make run`, `make bundle-raw` (unsigned test), `make dist`, `make install`.

`make install` copies the notarized universal app to `/Applications` and `codesign --verify --deep --strict`.

Version string: `PlistBuddy` on `Info.plist` `CFBundleShortVersionString`.

Do not copy `spm-app.mk` into an `.xcodeproj` app. No `swift build`, no `BUNDLE_APP` `cp` of a raw binary into `Contents/MacOS`, no Sparkle XPC re-sign, no `lipo`. Use `references/xcode-app.mk`.

## Finding an Xcode project

```bash
find . -maxdepth 2 -name "*.xcodeproj" -o -name "*.xcworkspace" | head -5
```

Then list available schemes:

```bash
xcodebuild -list -project "YourApp.xcodeproj" 2>/dev/null | grep -A 20 "Schemes:"
```

## Build command

Use this command template, replacing the project path and scheme:

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild build \
  -project "YourApp.xcodeproj" \
  -scheme "YourApp" \
  -configuration Debug \
  -destination "platform=macOS" \
  2>&1 | grep -E "(BUILD SUCCEEDED|BUILD FAILED|error:)" | head -20
```

For workspaces (projects with SPM dependencies or CocoaPods):

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild build \
  -workspace "YourApp.xcworkspace" \
  -scheme "YourApp" \
  -configuration Debug \
  -destination "platform=macOS" \
  2>&1 | grep -E "(BUILD SUCCEEDED|BUILD FAILED|error:)" | head -20
```

## Daily loop: make run vs make install

Users who have an `.xcodeproj` will ask for `make install`. That notarizes (~1 min) and copies to `/Applications` under the shipping bundle ID. For layout iteration, `make run` (Debug, no notary) is enough. Do not wait on Apple for every splitter tweak.

`make install` is method 1 (offline) only. If a Mac App Store / TestFlight build of that `CFBundleIdentifier` exists, `make install` overwrites it and the next store update overwrites you. Filename is not the identity. When the ship method is Mac App Store: default to `make run`. Ask before `make install`. Store QA is TestFlight. Details: `../distribution.md`.

Optional Debug ID so local and store sit side by side: `BUNDLE_ID.dev` + distinct `CFBundleDisplayName`. Optional Finder copy for method 1 only: `~/Applications/$(PROJECT_NAME)-dev.app`. Do not change the store bundle ID.

After replacing an installed app, quit the running process. Dock icon cache also needs a full quit, not only window close.

Read `references/cli-ship.md` before writing a Makefile, notarizing, installing to `/Applications`, or fixing a generic Dock icon. Copy `references/xcode-app.mk` to the repo as `Makefile`.

| Target              | What                                                          |
| ------------------- | ------------------------------------------------------------- |
| `build` / `run`     | Debug, host arch, `open` the `.app`                           |
| `release`           | Release, **host arch only** (`ARCHS=$(uname -m)`)             |
| `release-arm64`     | `ARCHS=arm64 ONLY_ACTIVE_ARCH=YES`                            |
| `release-x86_64`    | `ARCHS=x86_64 ONLY_ACTIVE_ARCH=YES`                           |
| `release-universal` | Fat binary. Opt-in only.                                      |
| `sign` / `zip`      | `codesign --options runtime`, then `ditto -c -k --keepParent` |
| `notarize`          | `notarytool submit --keychain-profile AC_PASSWORD --wait`     |
| `install`           | notarize, `ditto` to `/Applications`, `codesign --verify`     |

Default Release to **one arch**. Dist name must include it (`MyApp-VERSION-macOS-arm64`). Do not send people to Organizer for this loop.

One-time notary credentials: `xcrun notarytool store-credentials AC_PASSWORD`. Sign the built `.app`. Skip `ExportOptions.plist` / `-exportArchive` here (those are Mac App Store).

actool often writes a thin `AppIcon.icns` (16 + 128 only). Dock wants 256/512/1024. Build a full icns with `iconutil` and copy it over after `xcodebuild`. Details in `cli-ship.md`.

## Interpreting results

- **BUILD SUCCEEDED** -- the build passed, report success to the user.
- **BUILD FAILED** with `error:` lines -- read each error, identify the source file and line, and help the user fix them. After fixing, re-run the build to verify.
- If the output is empty or unclear, re-run without the grep filter to get full output for diagnosis.

## When to build

- After making code changes, if the user asks to verify they compile
- When the user explicitly says "build", "compile", or "check if it builds"
- After fixing build errors, to confirm the fix worked
- Layout iteration: `make run`. Signed install: `make install`.

## Xcode beta toolchains

If the project targets a beta SDK (e.g., macOS 26 Tahoe), you may need to point to the beta Xcode:

```bash
DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer xcodebuild build ...
```

Check which Xcode is available:

```bash
ls /Applications/ | grep -i xcode
```

## Common build failures

| Error                                    | Fix                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| `no such module 'Sparkle'`               | SPM dependency not resolved. Try `xcodebuild -resolvePackageDependencies` first             |
| `no signing identity found`              | Set `CODE_SIGN_IDENTITY=""` and `CODE_SIGNING_ALLOWED=NO` for command-line builds           |
| `SDK "macosx" cannot be located`         | Wrong `DEVELOPER_DIR`. Check Xcode installation path                                        |
| `scheme not found`                       | Run `xcodebuild -list` to see available schemes                                             |
| `missing return in getter` on a `switch` | One `case` with a local `let` turns the switch into statements. Every case needs `return`.  |
| `.secondary` / `.green` cannot resolve   | Write `Color.secondary`. Theme colors type-check; leading-dot does not.                     |
| `QLPreviewPanelDataSource` + `@MainActor`| `@preconcurrency QLPreviewPanelDataSource`                                                  |
| `RelativeDateTimeFormatter` not Sendable | `nonisolated(unsafe) static let` on the formatter                                           |
| `Dictionary.keys.union`                  | `Set(dict.keys).union(...)`                                                                 |
| `String` vs `Substring` in `\()`         | `String(s.prefix(8))`                                                                       |
| Table `if showColumn { TableColumn }`    | Needs macOS 14.4. Bump `MACOSX_DEPLOYMENT_TARGET` or always show the column.                |
| `NSOpenPanel` from a nonisolated static  | Mark the helper `@MainActor`                                                                |

Never invent `git` pretty-format atoms. Check `git help` before adding format strings.

`%1f` and `%x1f` are U+001F (UNIT SEPARATOR). Splitting on `\u{1C}` (FILE SEPARATOR) returns `[]`. Branch pickers, tag lists, and sidebar counts go empty while `git rev-parse --abbrev-ref HEAD` still works, so the toolbar can show a branch while a `Picker` is a blank chevron. Share one named constant (`"\u{1F}"`) between the format string and the parser. `%(upstream:track)` is valid. Do not invent `%(upstream:trackshort)`.
