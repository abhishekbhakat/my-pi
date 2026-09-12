# CLI ship for an Xcode macOS app

Offline / direct distribution for an `.xcodeproj`: Developer ID + notarize. Daily loop, no Organizer. Sparkle/DMG optional (macos-release). Mac App Store is a different method (`../distribution.md`, macos-app-store).

Read this before writing a Makefile, notarizing, installing to `/Applications`, or fixing a generic Dock icon.

## make run vs make install

| Target          | What it does                                       | When                                         |
| --------------- | -------------------------------------------------- | -------------------------------------------- |
| `make run`      | Debug `xcodebuild`, `open` the `.app`              | Layout, UI, every splitter tweak             |
| `make install`  | Release + notarize (~1 min) + copy `/Applications` | Method 1 only. Signed install, Gatekeeper    |

Do not wait on Apple notarization for UI iteration. After `make install`, quit the running app. Closing the window is not enough. If Dock keeps a blank tile, `killall Dock`, then open `/Applications/YourApp.app`.

`make install` writes `/Applications/$(PROJECT_NAME).app` under the shipping bundle ID. Mac App Store / TestFlight of the same `CFBundleIdentifier` replaces that copy. Launch Services, prefs, sandbox container, Keychain, TCC, URL handlers, Dock all collide. Filename is not the identity.

When the ship method is Mac App Store: `make run` only. Ask before `make install`. Store QA = TestFlight. Optional Debug ID: `BUNDLE_ID.dev` + distinct display name. Optional method-1 Finder copy: `~/Applications/$(PROJECT_NAME)-dev.app`. Do not change the store bundle ID. See `../../distribution.md`.

## Makefile

Copy `xcode-app.mk` to the repo as `Makefile`. Fill `PROJECT_NAME`, `BUNDLE_ID`, `TEAM_ID`.

| Target              | Command                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| `build`             | Debug `xcodebuild`, `-derivedDataPath build`                                                     |
| `run`               | `build` then `open` the `.app`                                                                   |
| `release`           | Release `xcodebuild`, **host arch only** (`ARCHS=$(uname -m)` `ONLY_ACTIVE_ARCH=YES`)            |
| `release-arm64`     | Same, `ARCH=arm64`                                                                               |
| `release-x86_64`    | Same, `ARCH=x86_64`                                                                              |
| `release-universal` | Fat binary. Opt-in only.                                                                         |
| `sign`              | `codesign --force --timestamp --options runtime --identifier BUNDLE_ID`                          |
| `zip`               | `ditto -c -k --keepParent`                                                                       |
| `notarize`          | `xcrun notarytool submit --keychain-profile AC_PASSWORD --wait` then `stapler staple`            |
| `install`           | notarize, then `ditto` to `/Applications` and `codesign --verify --deep --strict`                |

Defaults:

```
TEAM_ID ?= YOUR_TEAM_ID
SIGN_IDENTITY = Developer ID Application
NOTARY_PROFILE = AC_PASSWORD
```

Empty `DEVELOPMENT_TEAM` in the pbxproj is fine if the Makefile overrides it. Hardened runtime is `ENABLE_HARDENED_RUNTIME = YES` in the project.

Do not send people to Product > Archive for this loop.

## One arch by default

`xcodebuild` without `ARCHS` builds universal (arm64 + x86_64). Apple Silicon users never load the x86_64 slice.

```
ARCHS=arm64 ONLY_ACTIVE_ARCH=YES
ARCHS=x86_64 ONLY_ACTIVE_ARCH=YES
```

Dist name must include the arch: `MyApp-VERSION-macOS-arm64`, `MyApp-VERSION-macOS-x86_64`.

`release-universal` (`ARCHS="arm64 x86_64" ONLY_ACTIVE_ARCH=NO`) is the rare one-file download. Do not make it the default.

For `.xcodeproj`, `ARCHS` + `ONLY_ACTIVE_ARCH` is enough. Do not `swift build --arch` or `lipo`.

## CLI notarize (no Sparkle, no DMG)

One-time:

```bash
xcrun notarytool store-credentials AC_PASSWORD
```

Then:

```bash
xcodebuild build -configuration Release ... CODE_SIGN_IDENTITY="Developer ID Application"
codesign --force --timestamp --sign "Developer ID Application" --options runtime App.app
ditto -c -k --keepParent App.app App.zip
xcrun notarytool submit App.zip --keychain-profile AC_PASSWORD --wait
xcrun stapler staple App.app
```

Sign the built `.app`. Skip `ExportOptions.plist` and `xcodebuild -exportArchive` on this path. Those belong to the Mac App Store `.pkg` upload.

`notarytool` never uploads to the store. `altool --upload-app` / Transporter never notarize.

## Dock icon: actool icns is too thin

`ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon` plus a full `AppIcon.appiconset` (16 through 1024) can still leave Dock on the generic application icon. Finder may look fine.

Cause: actool writes `Contents/Resources/AppIcon.icns` with only 16px and 128px. Finder uses 128. Dock wants 256 / 512 / 1024 and falls back.

`CFBundleIconFile` / `CFBundleIconName` = `AppIcon` is not this bug.

Fix:

1. Keep the asset catalog for Xcode.
2. Build a full icns with `iconutil` from a `.iconset` that has every `icon_NxN.png` / `@2x` name.
3. After `xcodebuild`, copy that icns over actool's file, then `codesign` again.

```bash
iconutil -c icns AppIcon.iconset -o Resources/AppIcon.icns
cp Resources/AppIcon.icns App.app/Contents/Resources/AppIcon.icns
```

Check:

```bash
iconutil -c iconset App.app/Contents/Resources/AppIcon.icns
ls AppIcon.iconset
```

You want 10 PNGs, including `icon_512x512@2x.png` (1024):

```
icon_16x16.png        icon_16x16@2x.png
icon_32x32.png        icon_32x32@2x.png
icon_128x128.png      icon_128x128@2x.png
icon_256x256.png      icon_256x256@2x.png
icon_512x512.png      icon_512x512@2x.png
```

A ~20 KB icns is wrong. ~200 KB is in range. Point `ICON_ICNS` at that file in the Makefile so `run` / `sign` overwrite actool's output.

## Do not copy from an SPM Makefile

`spm-app.mk` is correct for `Package.swift` and wrong to paste into an Xcode app.

Do not copy:

- `swift build`, `BUNDLE_APP`, `cp` of a raw binary into `Contents/MacOS`
- Sparkle XPC re-sign / nested-sign
- `lipo` (Xcode uses `ARCHS`)
- Entitlements like `device.audio-input` or `disable-library-validation` into a git GUI

Do copy: `TEAM_ID`, `SIGN_IDENTITY`, `NOTARY_PROFILE`, `ditto` zip, `notarytool --wait`, `stapler`, `create-dmg` fallback, `install` after staple, per-arch dist names.
