---
name: macos-build
description: >
  Build a native macOS app from the command line. Prefer Swift Package Manager (`swift build`)
  when Package.swift exists; use xcodebuild only for .xcodeproj/.xcworkspace. Use when the user
  asks to build, compile, assemble an .app bundle without Xcode, fix Gradle-like path issues for
  Swift/macOS, or says "does it compile", "swift build", "xcodebuild", or "build the app".
  Also use for arch-specific SPM release binaries (arm64/x86_64), homemade .app layout, and
  writing a Makefile that bundles, codesigns, notarizes, and builds DMGs like a CLI macOS app.
---

# Build macOS App

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

## Finding an Xcode project

```bash
find . -maxdepth 2 -name "*.xcodeproj" -o -name "*.xcworkspace" | head -5
```

Then list available schemes:

```bash
xcodebuild -list -project "YourApp.xcodeproj" 2>/dev/null | grep -A 20 "Schemes:"
```

## Build Command

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

## Interpreting Results

- **BUILD SUCCEEDED** -- the build passed, report success to the user.
- **BUILD FAILED** with `error:` lines -- read each error, identify the source file and line, and help the user fix them. After fixing, re-run the build to verify.
- If the output is empty or unclear, re-run without the grep filter to get full output for diagnosis.

## When to Build

- After making code changes, if the user asks to verify they compile
- When the user explicitly says "build", "compile", or "check if it builds"
- After fixing build errors, to confirm the fix worked

## Xcode Beta Toolchains

If the project targets a beta SDK (e.g., macOS 26 Tahoe), you may need to point to the beta Xcode:

```bash
DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer xcodebuild build ...
```

Check which Xcode is available:

```bash
ls /Applications/ | grep -i xcode
```

## Common Build Failures

| Error | Fix |
|-------|-----|
| `no such module 'Sparkle'` | SPM dependency not resolved. Try `xcodebuild -resolvePackageDependencies` first |
| `no signing identity found` | Set `CODE_SIGN_IDENTITY=""` and `CODE_SIGNING_ALLOWED=NO` for command-line builds |
| `SDK "macosx" cannot be located` | Wrong `DEVELOPER_DIR`. Check Xcode installation path |
| `scheme not found` | Run `xcodebuild -list` to see available schemes |
