# Two distribution methods

A Mac app ships one of two ways. Same source can feed both (two schemes / two configs). Never mix identities, packages, or update mechanisms in one binary.

`make run` / `make install` are workflows on method 1. They are not a third method.

| Job              | 1. Offline / direct                         | 2. Mac App Store                                 |
| ---------------- | ------------------------------------------- | ------------------------------------------------ |
| Who installs     | User (your `.dmg` / `.zip` / `.app`)        | App Store                                        |
| Signing          | Developer ID Application                    | Apple Distribution                               |
| Apple gate       | Notarization (`notarytool`) + staple        | App Review after `.pkg` upload                   |
| Package          | `.app` / `.zip` / `.dmg` you host           | `.pkg` to App Store Connect                      |
| Updates          | None, or Sparkle + appcast                  | App Store only. Sparkle is rejected (2.4.5 vii)  |
| Sandbox          | Optional                                    | Required                                         |
| License screen   | Your keys OK                                | Not allowed. Store receipt is the license.       |
| Skills           | macos-build, macos-release, macos-auto-update | macos-app-store                                |

## 1. Offline / direct

Sign with Developer ID. Notarize. Staple. Gatekeeper then allows the download.

- Daily: `make run` (Debug, no notary). Signed local copy: `make install` (notarize, ~1 min).
- Hosted: zip or DMG + GitHub Release. Sparkle if you want in-app updates.
- `notarytool` never uploads to the store.

Skills: macos-build (compile, Makefile, notarize, `/Applications`), macos-release (DMG + GitHub + appcast), macos-auto-update (Sparkle).

## 2. Mac App Store

Sign with Apple Distribution. Export a `.pkg`. Upload. App Review. Apple hosts the install.

- No Sparkle, no `SUFeedURL`, no “Check for Updates”.
- App Sandbox on. No custom license-key screen.
- `altool` / Transporter never notarize.

Skill: macos-app-store.

## Dual-channel

Two schemes, two binaries:

- Offline scheme: Developer ID, notarize, Sparkle allowed.
- Store scheme: Apple Distribution, sandbox, Sparkle unlinked.

Store users never see Sparkle. GitHub users never go through App Review. Do not point a store build at a Sparkle feed.
