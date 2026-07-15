---
name: android-cli-build
description: >
  Build, install, and debug Android apps from the command line without Android Studio.
  Use when the user wants to create a new Android Gradle project, assemble a debug APK,
  install via adb, set up the Android SDK/cmdline-tools on macOS with Homebrew, fix
  Gradle/JDK/SDK path issues, or says "build the apk", "install on phone", "adb install",
  "no Android Studio", or "CLI Android build". Also use when scaffolding a Kotlin/Compose
  app that must compile with ./gradlew.
---

# Android CLI Build

Build Android apps with Homebrew, Android command-line tools, Gradle Wrapper, and adb. Android Studio is optional.

## Triggers

- Scaffold or build a Kotlin/Compose app in the terminal
- User works without Android Studio
- Install a debug APK on USB
- Fix `sdk.dir`, JDK, or `assembleDebug` failures

## Tools you need

| Tool | Role |
|------|------|
| JDK 17 | AGP 8.x (`openjdk@17` / Temurin 17; avoid bare latest JDK for AGP) |
| cmdline-tools | `sdkmanager` |
| platform-tools | `adb` |
| platforms + build-tools | Match `compileSdk` (e.g. `android-35`, `35.0.0`) |
| `./gradlew` | Project builds (global Gradle only to generate the wrapper) |

## Phase 0: deps

Mirror `android-reverse-engineering`:

```bash
SKILL_DIR="…/android-cli-build"   # path of this skill

bash "$SKILL_DIR/scripts/check-deps.sh"
# INSTALL_REQUIRED:java|sdk|adb|platforms|build-tools

bash "$SKILL_DIR/scripts/install-dep.sh" java
bash "$SKILL_DIR/scripts/install-dep.sh" sdk
bash "$SKILL_DIR/scripts/install-dep.sh" adb
bash "$SKILL_DIR/scripts/install-dep.sh" platforms
bash "$SKILL_DIR/scripts/install-dep.sh" build-tools

# or:
bash "$SKILL_DIR/scripts/install-dep.sh" all
```

`install-dep.sh` targets: `java`, `adb`, `sdk`, `platforms`, `build-tools`, `gradle` (optional), `all`.

```bash
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export ANDROID_PLATFORM=android-35
export ANDROID_BUILD_TOOLS=35.0.0
```

Apple Silicon Homebrew SDK root:

```text
/opt/homebrew/share/android-commandlinetools
```

Other scripts:

```bash
bash $SKILL_DIR/scripts/setup-sdk.sh
bash $SKILL_DIR/scripts/build-debug.sh [project-root]
```

### Manual install (same outcome)

```bash
brew install --cask android-commandlinetools android-platform-tools
brew install openjdk@17

export JAVA_HOME="/opt/homebrew/opt/openjdk@17"
export PATH="$JAVA_HOME/bin:/opt/homebrew/bin:$PATH"
export ANDROID_HOME="/opt/homebrew/share/android-commandlinetools"
export ANDROID_SDK_ROOT="$ANDROID_HOME"

yes | sdkmanager --sdk_root="$ANDROID_HOME" --licenses
sdkmanager --sdk_root="$ANDROID_HOME" \
  "platforms;android-35" \
  "build-tools;35.0.0" \
  "platform-tools"
```

## Project layout

```text
app/
  build.gradle.kts
  src/main/AndroidManifest.xml
  src/main/java/...
  src/main/res/...
build.gradle.kts
settings.gradle.kts
gradle.properties
gradle/wrapper/gradle-wrapper.properties
gradlew
local.properties    # gitignored
```

### local.properties

```properties
sdk.dir=/opt/homebrew/share/android-commandlinetools
```

```bash
echo "sdk.dir=${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}" > local.properties
```

Do not commit `local.properties`.

### Gradle wrapper

```bash
export JAVA_HOME="/opt/homebrew/opt/openjdk@17"
gradle wrapper --gradle-version 8.11.1
chmod +x gradlew
```

Pin the version in `gradle/wrapper/gradle-wrapper.properties`.

### Plugins (example)

Root:

```kotlin
plugins {
    id("com.android.application") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21" apply false
}
```

App module:

- `compileSdk = 35`; set `minSdk` for the feature set (28+ for Health Connect)
- `jvmTarget = "17"`
- Compose: `buildFeatures { compose = true }` + Kotlin Compose plugin
- Optional: `buildConfig = true` for `BuildConfig.VERSION_NAME`

## Build

```bash
export JAVA_HOME="/opt/homebrew/opt/openjdk@17"
export PATH="$JAVA_HOME/bin:/opt/homebrew/bin:$PATH"
export ANDROID_HOME="/opt/homebrew/share/android-commandlinetools"
export ANDROID_SDK_ROOT="$ANDROID_HOME"

cd /path/to/project
./gradlew :app:assembleDebug
```

APK:

```text
app/build/outputs/apk/debug/app-debug.apk
```

```bash
bash $SKILL_DIR/scripts/build-debug.sh /path/to/android/project
```

| Task | Use |
|------|-----|
| `./gradlew :app:assembleDebug` | Debug APK |
| `./gradlew :app:assembleRelease` | Release (needs signing) |
| `./gradlew :app:installDebug` | Build and install if a device is up |
| `./gradlew :app:testDebugUnitTest` | JVM unit tests |
| `./gradlew :app:compileDebugKotlin` | Compile only |

## Install (adb)

```bash
adb devices -l
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.example.app/.MainActivity
adb logcat --pid="$(adb shell pidof -s com.example.app)"
```

USB debugging on. Device authorized. `am start` must use the real applicationId and activity.

## Scaffold checklist

1. Create Gradle + `app` module (Kotlin DSL).
2. Write `local.properties` with `sdk.dir`.
3. Add `gradlew` (wrapper) if missing.
4. Run `assembleDebug`; fix the first compile errors.
5. `adb install -r` when a phone is connected.
6. Keep files short (~300 lines); split `ui/`, `data/`, etc.

## Compose traps

### Modifier import

Package `androidx.compose.ui`, class `Modifier`:

```kotlin
import androidx.compose.ui.Modifier
```

This path fails:

```kotlin
import androidx.compose.ui.modifier.Modifier
```

### Status bar overlap

Android 15/16 draws under the notification bar. Use safe drawing insets:

```kotlin
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding

Modifier = Modifier
    .fillMaxSize()
    .windowInsetsPadding(WindowInsets.safeDrawing)
    .padding(24.dp)
```

### Health Connect

- minSdk 28+
- Manifest `android.permission.health.WRITE_*`
- Query `com.google.android.apps.healthdata`
- `getSdkStatus()` before `getOrCreate`
- `insertRecords` in chunks of ≤1000
- Stable `clientRecordId` for re-import

## gitignore vs Kotlin `data/`

On case-insensitive macOS volumes, unanchored `DATA/` also ignores `…/data/` sources.

```gitignore
# repo-root export only
/DATA/

# bad: matches package data/
DATA/
```

```bash
git check-ignore -v path/to/package/data/SomeFile.kt
```

## Troubleshooting

Details: [references/troubleshooting.md](references/troubleshooting.md).

| Symptom | Fix |
|---------|-----|
| `SDK location not found` | `local.properties` → `sdk.dir=…` |
| AGP fails on JDK 26 | `JAVA_HOME=…/openjdk@17` |
| `sdkmanager: command not found` | `brew install --cask android-commandlinetools` |
| Licenses | `yes \| sdkmanager --licenses` |
| Device unauthorized | Unlock, accept RSA, `adb kill-server && adb devices` |
| `Permission Denial` on start | Activity is not exported; open from the launcher |
| `Unresolved reference 'Modifier'` | `import androidx.compose.ui.Modifier` |

## Agent steps

1. `check-deps.sh` → `install-dep.sh` for each `INSTALL_REQUIRED:*` (or `all`).
2. Set `JAVA_HOME` (17) and `ANDROID_HOME`.
3. Create `local.properties` if missing.
4. `./gradlew :app:assembleDebug` (or compile-only while editing).
5. On failure, read the first Kotlin `e:` lines, fix, rebuild.
6. With a device: `adb install -r`, then start the activity.
7. Skip Android Studio unless the user asks for it.

## Out of scope unless asked

- Play signing / Play App Signing
- AVD/emulator setup (use a physical device when one is plugged in)
- NDK/CMake on projects that do not already use native code
