#!/usr/bin/env bash
# One-time Android CLI SDK setup (macOS Homebrew).
set -euo pipefail

export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17}"
export PATH="$JAVA_HOME/bin:/opt/homebrew/bin:$PATH"
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"

echo "==> JAVA_HOME=$JAVA_HOME"
java -version

if ! command -v sdkmanager >/dev/null 2>&1; then
  echo "==> Installing android-commandlinetools + platform-tools"
  brew install --cask android-commandlinetools android-platform-tools
fi

if [[ ! -d "$JAVA_HOME" ]]; then
  echo "==> Installing openjdk@17"
  brew install openjdk@17
fi

echo "==> Accepting licenses + installing platform 35 / build-tools"
yes | sdkmanager --sdk_root="$ANDROID_HOME" --licenses >/dev/null || true
sdkmanager --sdk_root="$ANDROID_HOME" \
  "platforms;android-35" \
  "build-tools;35.0.0" \
  "platform-tools"

echo "==> Done"
echo "    ANDROID_HOME=$ANDROID_HOME"
echo "    adb: $(command -v adb)"
echo "    sdkmanager: $(command -v sdkmanager)"
