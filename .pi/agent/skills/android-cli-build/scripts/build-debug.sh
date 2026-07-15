#!/usr/bin/env bash
# Build debug APK for an Android Gradle project (CLI).
# Usage: build-debug.sh [project-root]
set -euo pipefail

ROOT="$(cd "${1:-.}" && pwd)"
cd "$ROOT"

export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17}"
export PATH="$JAVA_HOME/bin:/opt/homebrew/bin:$PATH"
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"

if [[ ! -f "$ROOT/settings.gradle.kts" && ! -f "$ROOT/settings.gradle" ]]; then
  echo "Not an Android Gradle project root: $ROOT" >&2
  exit 1
fi

if [[ ! -f local.properties ]]; then
  echo "sdk.dir=$ANDROID_HOME" > local.properties
  echo "Wrote local.properties"
fi

if [[ ! -x ./gradlew ]]; then
  if command -v gradle >/dev/null 2>&1; then
    gradle wrapper --gradle-version 8.11.1
    chmod +x gradlew
  else
    echo "gradlew missing and gradle not installed. Install gradle or add the wrapper." >&2
    exit 1
  fi
fi

./gradlew :app:assembleDebug

APK="$ROOT/app/build/outputs/apk/debug/app-debug.apk"
echo
echo "APK: $APK"

if command -v adb >/dev/null 2>&1 && adb devices 2>/dev/null | grep -q 'device$'; then
  echo "Device connected. Install with:"
  echo "  adb install -r \"$APK\""
fi
