---
name: macos-app-store
description: >
  Mac App Store distribution for a native Mac app (Apple Distribution, App Review, .pkg upload).
  Use when the user wants a store listing, store vs offline/direct/notarize, App Sandbox for the
  store, Small Business Program, or to drop Sparkle from a store binary. Dual-channel (store +
  Developer ID) is supported. Do not use for offline notarize (macos-build) or Sparkle GitHub
  releases (macos-release). notarytool never uploads to the store.
---

# Mac App Store distribution

Two methods. Read `../distribution.md` before signing or shipping. This skill is method 2.

| Method        | Gate                                 | This skill                                      |
| ------------- | ------------------------------------ | ----------------------------------------------- |
| Offline       | Developer ID + `notarytool` + staple | none. macos-build + macos-release               |
| Mac App Store | Apple Distribution + App Review      | sandbox, no Sparkle, archive, `.pkg`, upload    |

Do not mix. `notarytool` never uploads to the store. `altool` / Transporter never notarize.

| Channel                                 | What you ship              | Apple cut | You keep on $5 |
| --------------------------------------- | -------------------------- | --------- | -------------- |
| Mac App Store (standard)                | Paid listing + Apple IAP   | 30%       | $3.50          |
| Mac App Store + Small Business Program  | Same, under $1M proceeds   | 15%       | $4.25          |
| Offline / direct (notarize + Sparkle)   | `.dmg` / `.zip` you host   | $0        | ~$5 minus fees |

## What Apple takes

- Small Business Program threshold is **proceeds**, not gross: sales minus Apple’s commission and certain taxes, across **all** Apple Developer accounts, in USD, for the prior calendar year.
- New developers and first-year accounts qualify automatically if they enroll.
- If you cross $1M proceeds in the current year, **30%** applies to **future** sales for the rest of that year. Re-qualify the next year if you drop back under.
- Auto-renewable subscriptions: 30% year one, 15% after a subscriber’s first paid year. SBP members already sit at 15% from day one on paid apps / IAP.
- Apple Developer Program is **$99/year**. That fee does not change the commission rate.
- EU storefronts have extra DMA terms. Ignore unless the user opts into those terms. Default worldwide terms are the 30% / 15% table above.

Official: [developer.apple.com/app-store/small-business-program](https://developer.apple.com/app-store/small-business-program/)

## Enroll in the 15% Small Business Program

Individual / sole-prop accounts list **legal name** as the seller.

Prerequisites: Account Holder; latest Paid Apps agreement (Schedule 2); disclose Associated Developer Accounts (a lone sole-prop with no other teams is usually “none”).

1. Sign in to [App Store Connect](https://appstoreconnect.apple.com).
2. Open **Agreements, Tax, and Banking**.
3. Accept the current **Paid Apps** / Schedule 2 agreement if it is pending.
4. Finish **Tax** and **Banking**. Paid sales cannot pay out without these.
5. Home page → **App Store Small Business Program** → **Learn More**.
6. Confirm Paid Applications Agreement. Answer associated-account questions. Submit.
7. Apple decides eligibility within **15 days after the end of the fiscal calendar month** of approval. The 15% rate starts on that lag. Example from Apple: approved Feb 10 → proceeds adjust starting March 14.

If the bank is in USD, add App Store deposits for the prior calendar year, then adjust using **Payments and Financial Reports**. Never sold on the store: prior-year proceeds are zero.

## What changes vs offline

Full comparison: `../distribution.md`. Store extras: sandbox required, no license-key screen, login items restricted, Apple collects price/tax/refunds, every version is reviewed.

Notarizing an offline build does not put it on the store.

App Review 2.4.5 (vii): Mac App Store apps must use the Mac App Store to distribute updates. Also 2.4.5 (i) sandbox, (ii) Xcode packaging / no third-party installers, (vi) no license-key screens.

## App changes before the first store build

Treat this as a separate product flavor, even if the source is shared.

### Remove Sparkle from the store binary

- Do not link `Sparkle.framework` in the App Store configuration.
- Do not ship `SUFeedURL`, `SUPublicEDKey`, or `SUEnableInstallerLauncherService` in the store `Info.plist`.
- Strip “Check for Updates…” from the store build’s menu.
- One target, two configs (`Release` for store, `Release-Sparkle` for GitHub), with `#if SPARKLE` / a `SPARKLE` compiler flag so the framework is only linked on the direct-distribution scheme.

If Sparkle stays in the uploaded binary, review will reject it. Do **not** point a store build at a Sparkle feed “just in case.”

### Turn the App Sandbox on

- Enable **App Sandbox** (`com.apple.security.app-sandbox`).
- Add only the entitlements you actually need.
- Move writes out of shared locations into the container (`~/Library/Containers/...`) or use security-scoped bookmarks for user-chosen folders.
- Keep Hardened Runtime on for the store build too.

### Drop custom licensing

- No serial-key screen, no “paste your license.”
- The Mac App Store receipt (`Contents/_MASReceipt/receipt`) is how you know the user paid.
- If features currently gate on a license file, replace that path with StoreKit / receipt validation for the store flavor.

### Versioning and identity

- `CFBundleShortVersionString` = marketing version (`1.2.0`).
- `CFBundleVersion` = **build number**, must **strictly increase** on every upload (`42`, `43`, …). You cannot reuse a build number App Store Connect has already seen.
- Bundle ID must match the App Store Connect app record.
- Team ID must match the membership that owns that record.
- Use a **Mac App Store** provisioning profile + **Apple Distribution** certificate, not Developer ID.

## One-time App Store Connect setup

1. App Store Connect → **My Apps** → **+** → New Mac app.
2. Bundle ID (must already exist in the developer portal), name, primary language, SKU.
3. Pricing: store tiers are Apple’s (`$4.99` / `$5.00`), not a free-form $5 in every country.
4. Privacy policy URL, category, age rating, screenshots, description, “What’s New.”
5. Encryption / export compliance.
6. Paid Apps agreement + banking + tax active.

You can upload builds before metadata is perfect. You cannot **submit for review** until metadata, screenshots, and agreements are complete.

## Certificates

Keep **both** identities on the machine.

| Purpose                             | Certificate                 | Profile                                      |
| ----------------------------------- | --------------------------- | -------------------------------------------- |
| GitHub / Sparkle / notarized DMG    | Developer ID Application    | None (Developer ID is the profile)           |
| Mac App Store upload                | Apple Distribution          | Mac App Store profile for that bundle ID     |

Create the store cert and profile in [developer.apple.com/account](https://developer.apple.com/account) → Certificates, Identifiers & Profiles, or let `xcodebuild -allowProvisioningUpdates` create them when signed into the team.

Do not notarize the App Store `.pkg`. Apple re-signs store binaries.

## CLI pipeline: archive → export → upload

Command Line Tools + a `.xcodeproj` / `.xcworkspace` are enough. This configuration must **not** link Sparkle.

### Archive (Release, generic Mac)

```bash
xcodebuild archive \
  -project MyApp.xcodeproj \
  -scheme MyApp \
  -configuration Release \
  -destination 'generic/platform=macOS' \
  -archivePath ./build/MyApp.xcarchive \
  CODE_SIGN_STYLE=Automatic \
  DEVELOPMENT_TEAM=YOURTEAMID
```

Use `-workspace MyApp.xcworkspace` if you have a workspace.

### ExportOptions.plist

`method` must be `app-store-connect` (`app-store` is deprecated).

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>app-store-connect</string>
  <key>teamID</key>
  <string>YOURTEAMID</string>
  <key>destination</key>
  <string>export</string>
  <key>signingStyle</key>
  <string>automatic</string>
  <key>uploadSymbols</key>
  <true/>
</dict>
</plist>
```

Optional: `destination` = `upload` to push in the same step. `export` is easier to inspect first. For Mac, the exported artifact is a **`.pkg`**, not an `.ipa`.

### Export

```bash
xcodebuild -exportArchive \
  -archivePath ./build/MyApp.xcarchive \
  -exportPath ./build/export \
  -exportOptionsPlist ./ExportOptions.plist \
  -allowProvisioningUpdates
```

You should get `./build/export/MyApp.pkg`.

### Upload

Auth with an [app-specific password](https://appleid.apple.com) or an App Store Connect API key. `altool` is deprecated **for notarization only**; Apple still documents it for store uploads. Transporter is the other official path.

```bash
xcrun altool --upload-app \
  -f ./build/export/MyApp.pkg \
  -t macos \
  -u YOUR_APPLE_ID@email.com \
  -p "@keychain:AC_PASSWORD" \
  --output-format xml
```

```bash
xcrun iTMSTransporter -m upload \
  -u YOUR_APPLE_ID@email.com \
  -p "@keychain:AC_PASSWORD" \
  -assetFile ./build/export/MyApp.pkg
```

API-key auth (preferred in scripts). The `.p8` lives in `~/.appstoreconnect/private_keys/AuthKey_KEYID.p8`:

```bash
xcrun altool --upload-app \
  -f ./build/export/MyApp.pkg \
  -t macos \
  --apiKey YOUR_KEY_ID \
  --apiIssuer YOUR_ISSUER_UUID
```

After upload: Processing → Ready to Submit. Minutes to an hour.

### Submit for review

Still a Connect step:

1. Select the processed build on the version page.
2. Fill “What’s New.”
3. Answer encryption / advertising / content questions if prompted.
4. **Add for Review** → **Submit to App Review**.

Review is required on the first version and on every subsequent version. Budget a day or two; more for the first submission and for anything that touches sandbox, files, or networking.

## How updates work on the store

No appcast. No GitHub Release for store users.

1. Bump `CFBundleVersion` (and marketing version if it is user-facing).
2. Archive → export → upload the **store** flavor (no Sparkle).
3. Wait for processing.
4. Submit that build for review with release notes.
5. After approval, Apple hosts the binary. Users with **App Store → Settings → Automatic Updates** on get it in the background.

You lose same-hour Sparkle ships, self-hosted delta patches, and hot-fix without review. You gain Apple CDN, signing, receipt, refunds, and the update UI.

## Dual-channel

Many Mac developers keep both:

- Store build: sandboxed, no Sparkle, Apple Distribution, store price, 15% if enrolled.
- Direct build: Developer ID + `notarytool` + staple + Sparkle appcast on GitHub.

Same codebase, two schemes. Store users never see Sparkle. GitHub users never go through App Review.

Shipping `CFBundleIdentifier` stays the store record. Do not change it to dodge Launch Services. TestFlight on Mac replaces the store app for that ID. Do not also `make install` Developer ID to `/Applications`. Daily loop next to a live store copy is `make run` (Debug under `build/`). Store QA is TestFlight. Coexistence patterns: `../distribution.md`.

Sparkle on a Developer ID binary in `/Applications` can try to update the MAS copy of the same ID. Store binary must unlink Sparkle. Developer ID Sparkle binary must not live in `/Applications` next to MAS.

## Ordered checklist

Money and account:

- [ ] Paid Apps agreement accepted
- [ ] Tax and banking complete
- [ ] Small Business Program form submitted
- [ ] Price tier set
- [ ] Confirm 15% is active after the fiscal-month lag, or assume 30% until then

App changes:

- [ ] App Sandbox on for the store scheme
- [ ] Sparkle unlinked and `SU*` keys removed from the store `Info.plist`
- [ ] “Check for Updates” hidden on the store scheme
- [ ] License-key UI removed from the store scheme
- [ ] File paths work inside the container
- [ ] Bundle ID matches the Connect record
- [ ] Build number increments on every upload

Signing:

- [ ] Apple Distribution certificate installed
- [ ] Mac App Store provisioning profile for the bundle ID
- [ ] Developer ID cert kept separately for the GitHub channel

First store upload:

- [ ] `xcodebuild archive` with store scheme / Release / `generic/platform=macOS`
- [ ] `ExportOptions.plist` with `method = app-store-connect`
- [ ] `xcodebuild -exportArchive` produces a `.pkg`
- [ ] `altool --upload-app -t macos` or `iTMSTransporter` succeeds
- [ ] Build reaches Ready to Submit
- [ ] Metadata + screenshots + privacy policy complete
- [ ] Submitted for review

After approval:

- [ ] Verify listing, price, and seller name
- [ ] Confirm a test purchase and payout rate
- [ ] Decide whether the Sparkle/GitHub channel stays as a second flavor

## Links

- Small Business Program: https://developer.apple.com/app-store/small-business-program/
- App Review Guidelines (Mac extras in 2.4.5): https://developer.apple.com/app-store/review/guidelines/
- Upload builds: https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds
- Packaging Mac software: https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution
- Sparkle (direct channel only): https://sparkle-project.org/documentation/
