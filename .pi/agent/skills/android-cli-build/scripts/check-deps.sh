#!/usr/bin/env bash
# check-deps.sh — Verify Android CLI build dependencies
# Prints machine-readable INSTALL_REQUIRED:<dep> / INSTALL_OPTIONAL:<dep> lines.
set -euo pipefail

REQUIRED_JAVA_MAJOR=17
ANDROID_PLATFORM="${ANDROID_PLATFORM:-android-35}"
ANDROID_BUILD_TOOLS="${ANDROID_BUILD_TOOLS:-35.0.0}"

errors=0
missing_required=()
missing_optional=()

echo "=== Android CLI Build: Dependency Check ==="
echo

default_android_home() {
  if [[ -n "${ANDROID_HOME:-}" ]]; then echo "$ANDROID_HOME"; return; fi
  if [[ -n "${ANDROID_SDK_ROOT:-}" ]]; then echo "$ANDROID_SDK_ROOT"; return; fi
  if [[ -d /opt/homebrew/share/android-commandlinetools ]]; then
    echo "/opt/homebrew/share/android-commandlinetools"; return
  fi
  if [[ -d "$HOME/Library/Android/sdk" ]]; then echo "$HOME/Library/Android/sdk"; return; fi
  if [[ -d "$HOME/Android/Sdk" ]]; then echo "$HOME/Android/Sdk"; return; fi
  echo ""
}

ANDROID_HOME_RESOLVED="$(default_android_home)"
if [[ -n "$ANDROID_HOME_RESOLVED" ]]; then
  export ANDROID_HOME="$ANDROID_HOME_RESOLVED"
  export ANDROID_SDK_ROOT="$ANDROID_HOME"
fi

# Prefer JDK 17 on PATH for version check
if [[ -x /opt/homebrew/opt/openjdk@17/bin/java ]]; then
  export PATH="/opt/homebrew/opt/openjdk@17/bin:$PATH"
  export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17}"
fi

# --- Java ---
if command -v java &>/dev/null; then
  java_version_output=$(java -version 2>&1 | head -1)
  java_version=$(echo "$java_version_output" | sed -n 's/.*"\([0-9]*\)\..*/\1/p')
  if [[ -z "$java_version" ]]; then
    java_version=$(echo "$java_version_output" | grep -oE '[0-9]+' | head -1 || true)
  fi
  if [[ "$java_version" == "1" ]]; then
    java_version=$(echo "$java_version_output" | sed -n 's/.*"1\.\([0-9]*\)\..*/\1/p')
  fi
  if [[ -n "$java_version" ]] && (( java_version >= REQUIRED_JAVA_MAJOR )); then
    echo "[OK] Java $java_version ($java_version_output)"
  else
    echo "[MISSING] Java $REQUIRED_JAVA_MAJOR+ required (found: ${java_version:-none})"
    errors=$((errors + 1))
    missing_required+=("java")
  fi
else
  echo "[MISSING] Java not in PATH"
  errors=$((errors + 1))
  missing_required+=("java")
fi

# --- sdkmanager ---
sdkmanager_path=""
if command -v sdkmanager &>/dev/null; then
  sdkmanager_path=$(command -v sdkmanager)
elif [[ -n "${ANDROID_HOME:-}" && -x "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" ]]; then
  sdkmanager_path="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
fi

if [[ -n "$sdkmanager_path" ]]; then
  echo "[OK] sdkmanager: $sdkmanager_path"
else
  echo "[MISSING] Android cmdline-tools / sdkmanager"
  errors=$((errors + 1))
  missing_required+=("sdk")
fi

# --- ANDROID_HOME ---
if [[ -n "${ANDROID_HOME:-}" && -d "$ANDROID_HOME" ]]; then
  echo "[OK] ANDROID_HOME=$ANDROID_HOME"
else
  echo "[MISSING] ANDROID_HOME not set or not a directory"
  errors=$((errors + 1))
  if [[ ! " ${missing_required[*]} " =~ " sdk " ]]; then
    missing_required+=("sdk")
  fi
fi

# --- platform ---
if [[ -n "${ANDROID_HOME:-}" && -d "$ANDROID_HOME/platforms/$ANDROID_PLATFORM" ]]; then
  echo "[OK] platforms;$ANDROID_PLATFORM"
else
  echo "[MISSING] platforms;$ANDROID_PLATFORM under ANDROID_HOME"
  errors=$((errors + 1))
  missing_required+=("platforms")
fi

# --- build-tools ---
if [[ -n "${ANDROID_HOME:-}" && -d "$ANDROID_HOME/build-tools/$ANDROID_BUILD_TOOLS" ]]; then
  echo "[OK] build-tools;$ANDROID_BUILD_TOOLS"
else
  echo "[MISSING] build-tools;$ANDROID_BUILD_TOOLS under ANDROID_HOME"
  errors=$((errors + 1))
  missing_required+=("build-tools")
fi

# --- adb ---
if command -v adb &>/dev/null; then
  echo "[OK] adb: $(adb version 2>&1 | head -1)"
else
  echo "[MISSING] adb (required to install APKs on a device)"
  errors=$((errors + 1))
  missing_required+=("adb")
fi

# --- gradle (optional) ---
if command -v gradle &>/dev/null; then
  echo "[OK] gradle (optional): $(command -v gradle)"
else
  echo "[MISSING] gradle (optional — only needed to generate ./gradlew once)"
  missing_optional+=("gradle")
fi

echo
if (( errors > 0 )); then
  echo "Missing required dependencies:"
  for dep in "${missing_required[@]}"; do
    echo "  INSTALL_REQUIRED:$dep"
  done
else
  echo "All required dependencies OK."
fi

if (( ${#missing_optional[@]} > 0 )); then
  echo "Optional missing:"
  for dep in "${missing_optional[@]}"; do
    echo "  INSTALL_OPTIONAL:$dep"
  done
fi

echo
echo "Install with:"
echo "  bash $0 --help 2>/dev/null || true"
echo "  bash \"$(cd "$(dirname "$0")" && pwd)/install-dep.sh\" <dep>"
echo "  bash \"$(cd "$(dirname "$0")" && pwd)/install-dep.sh\" all"

exit $(( errors > 0 ? 1 : 0 ))
