#!/usr/bin/env bash
# install-dep.sh — Install a single dependency for Android CLI builds
# Usage: install-dep.sh <dependency>
# Dependencies: java, adb, sdk, platforms, build-tools, gradle, all
#
# Exit codes:
#   0 — installed successfully (or already present)
#   1 — installation failed
#   2 — requires manual action
set -euo pipefail

usage() {
  cat <<EOF
Usage: install-dep.sh <dependency>

Install a dependency required for Android CLI app builds (no Android Studio).

Available dependencies:
  java          Java JDK 17 (preferred for AGP 8.x)
  adb           Android Debug Bridge (platform-tools)
  sdk           Android cmdline-tools (sdkmanager) + ANDROID_HOME layout
  platforms     Android SDK platform (default: android-35)
  build-tools   Android build-tools (default: 35.0.0)
  gradle        System Gradle (optional; only to generate ./gradlew once)
  all           java + sdk + adb + platforms + build-tools

The script detects your OS and package manager, then:
  - Installs via Homebrew casks/formulae when possible
  - Uses sudo + apt/dnf/pacman on Linux when needed
  - Prints manual instructions if neither option works

Environment (optional overrides):
  ANDROID_HOME / ANDROID_SDK_ROOT   SDK root
  ANDROID_PLATFORM                  e.g. android-35
  ANDROID_BUILD_TOOLS               e.g. 35.0.0
  JAVA_HOME                         JDK home
EOF
  exit 0
}

if [[ $# -lt 1 || "$1" == "-h" || "$1" == "--help" ]]; then
  usage
fi

DEP="$1"
ANDROID_PLATFORM="${ANDROID_PLATFORM:-android-35}"
ANDROID_BUILD_TOOLS="${ANDROID_BUILD_TOOLS:-35.0.0}"

# --- Detect environment ---
OS="unknown"
PKG_MANAGER="none"
HAS_SUDO=false
ARCH=$(uname -m)

case "$(uname -s)" in
  Linux)  OS="linux" ;;
  Darwin) OS="macos" ;;
esac

if command -v brew &>/dev/null; then
  PKG_MANAGER="brew"
elif command -v apt-get &>/dev/null; then
  PKG_MANAGER="apt"
elif command -v dnf &>/dev/null; then
  PKG_MANAGER="dnf"
elif command -v pacman &>/dev/null; then
  PKG_MANAGER="pacman"
fi

if command -v sudo &>/dev/null; then
  HAS_SUDO=true
fi

info()  { echo "[INFO] $*"; }
ok()    { echo "[OK] $*"; }
fail()  { echo "[FAIL] $*" >&2; }
manual() {
  echo "[MANUAL] $*" >&2
  echo "         Cannot install automatically. Please install manually and retry." >&2
  exit 2
}

default_android_home() {
  if [[ -n "${ANDROID_HOME:-}" ]]; then
    echo "$ANDROID_HOME"
    return
  fi
  if [[ -n "${ANDROID_SDK_ROOT:-}" ]]; then
    echo "$ANDROID_SDK_ROOT"
    return
  fi
  if [[ "$OS" == "macos" && -d /opt/homebrew/share/android-commandlinetools ]]; then
    echo "/opt/homebrew/share/android-commandlinetools"
    return
  fi
  if [[ -d "$HOME/Library/Android/sdk" ]]; then
    echo "$HOME/Library/Android/sdk"
    return
  fi
  if [[ -d "$HOME/Android/Sdk" ]]; then
    echo "$HOME/Android/Sdk"
    return
  fi
  # Preferred install target when nothing exists yet
  if [[ "$OS" == "macos" ]]; then
    echo "/opt/homebrew/share/android-commandlinetools"
  else
    echo "$HOME/Android/Sdk"
  fi
}

export ANDROID_HOME="$(default_android_home)"
export ANDROID_SDK_ROOT="$ANDROID_HOME"

pkg_install() {
  local pkg="$1"
  case "$PKG_MANAGER" in
    brew)
      info "Installing $pkg via Homebrew..."
      brew install "$pkg"
      ;;
    apt)
      if [[ "$HAS_SUDO" == true ]]; then
        info "Installing $pkg via apt..."
        sudo apt-get update -qq && sudo apt-get install -y -qq "$pkg"
      else
        manual "Run: sudo apt-get install $pkg"
      fi
      ;;
    dnf)
      if [[ "$HAS_SUDO" == true ]]; then
        info "Installing $pkg via dnf..."
        sudo dnf install -y "$pkg"
      else
        manual "Run: sudo dnf install $pkg"
      fi
      ;;
    pacman)
      if [[ "$HAS_SUDO" == true ]]; then
        info "Installing $pkg via pacman..."
        sudo pacman -S --noconfirm "$pkg"
      else
        manual "Run: sudo pacman -S $pkg"
      fi
      ;;
    *)
      manual "No supported package manager found. Install $pkg manually."
      ;;
  esac
}

pkg_install_cask() {
  local cask="$1"
  if [[ "$PKG_MANAGER" != "brew" ]]; then
    return 1
  fi
  info "Installing cask $cask via Homebrew..."
  brew install --cask "$cask"
}

add_to_profile() {
  local line="$1"
  local profile=""
  if [[ -f "$HOME/.zshrc" ]]; then
    profile="$HOME/.zshrc"
  elif [[ -f "$HOME/.bashrc" ]]; then
    profile="$HOME/.bashrc"
  elif [[ -f "$HOME/.profile" ]]; then
    profile="$HOME/.profile"
  fi
  if [[ -n "$profile" ]]; then
    if ! grep -qF "$line" "$profile" 2>/dev/null; then
      echo "$line" >> "$profile"
      info "Added to $profile: $line"
    fi
  else
    info "Add this to your shell profile: $line"
  fi
}

ensure_java_on_path() {
  if command -v java &>/dev/null; then
    return 0
  fi
  if [[ -x /opt/homebrew/opt/openjdk@17/bin/java ]]; then
    export JAVA_HOME="/opt/homebrew/opt/openjdk@17"
    export PATH="$JAVA_HOME/bin:$PATH"
  elif [[ -x /usr/lib/jvm/java-17-openjdk-amd64/bin/java ]]; then
    export JAVA_HOME="/usr/lib/jvm/java-17-openjdk-amd64"
    export PATH="$JAVA_HOME/bin:$PATH"
  fi
}

java_major() {
  ensure_java_on_path
  if ! command -v java &>/dev/null; then
    echo ""
    return
  fi
  local out ver
  out=$(java -version 2>&1 | head -1)
  ver=$(echo "$out" | sed -n 's/.*"\([0-9]*\)\..*/\1/p')
  if [[ -z "$ver" ]]; then
    ver=$(echo "$out" | grep -oE '[0-9]+' | head -1)
  fi
  if [[ "$ver" == "1" ]]; then
    ver=$(echo "$out" | sed -n 's/.*"1\.\([0-9]*\)\..*/\1/p')
  fi
  echo "$ver"
}

find_sdkmanager() {
  if command -v sdkmanager &>/dev/null; then
    command -v sdkmanager
    return 0
  fi
  local candidates=(
    "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
    "$ANDROID_HOME/cmdline-tools/bin/sdkmanager"
    /opt/homebrew/bin/sdkmanager
  )
  local c
  for c in "${candidates[@]}"; do
    if [[ -x "$c" ]]; then
      echo "$c"
      return 0
    fi
  done
  return 1
}

run_sdkmanager() {
  local sm
  sm=$(find_sdkmanager) || {
    fail "sdkmanager not found. Install 'sdk' first."
    exit 1
  }
  ensure_java_on_path
  "$sm" --sdk_root="$ANDROID_HOME" "$@"
}

# =====================================================================
# Installers
# =====================================================================

install_java() {
  local ver
  ver=$(java_major)
  if [[ -n "$ver" ]] && (( ver >= 17 )); then
    ok "Java $ver already available ($(command -v java))"
    if [[ -z "${JAVA_HOME:-}" ]]; then
      if [[ -d /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk ]]; then
        export JAVA_HOME="/opt/homebrew/opt/openjdk@17"
      fi
    fi
    return 0
  fi

  info "Installing Java JDK 17..."
  case "$PKG_MANAGER" in
    brew)
      brew install openjdk@17
      export JAVA_HOME="/opt/homebrew/opt/openjdk@17"
      export PATH="$JAVA_HOME/bin:$PATH"
      add_to_profile 'export PATH="/opt/homebrew/opt/openjdk@17/bin:$PATH"'
      add_to_profile 'export JAVA_HOME="/opt/homebrew/opt/openjdk@17"'
      ;;
    apt)     pkg_install "openjdk-17-jdk" ;;
    dnf)     pkg_install "java-17-openjdk-devel" ;;
    pacman)  pkg_install "jdk17-openjdk" ;;
    *)       manual "Install Java 17 from https://adoptium.net/" ;;
  esac

  ver=$(java_major)
  if [[ -n "$ver" ]] && (( ver >= 17 )); then
    ok "Java $ver installed"
  else
    fail "Java 17+ not on PATH after install. Open a new shell or export JAVA_HOME."
    exit 1
  fi
}

install_adb() {
  if command -v adb &>/dev/null; then
    ok "adb already installed: $(command -v adb)"
    return 0
  fi

  case "$PKG_MANAGER" in
    brew)
      # cask name is android-platform-tools
      if ! pkg_install_cask "android-platform-tools"; then
        brew install android-platform-tools 2>/dev/null || true
      fi
      ;;
    apt)     pkg_install "adb" ;;
    dnf|pacman) pkg_install "android-tools" ;;
    *)
      manual "Install platform-tools from https://developer.android.com/tools/releases/platform-tools"
      ;;
  esac

  # Also try sdkmanager package if cmdline-tools exist
  if ! command -v adb &>/dev/null && find_sdkmanager &>/dev/null; then
    info "Installing platform-tools via sdkmanager..."
    run_sdkmanager "platform-tools" || true
    export PATH="$ANDROID_HOME/platform-tools:$PATH"
    add_to_profile "export PATH=\"$ANDROID_HOME/platform-tools:\$PATH\""
  fi

  if command -v adb &>/dev/null; then
    ok "adb installed: $(adb version 2>&1 | head -1)"
  else
    fail "adb not on PATH after install"
    exit 1
  fi
}

install_sdk() {
  mkdir -p "$ANDROID_HOME"

  if find_sdkmanager &>/dev/null; then
    ok "sdkmanager already available: $(find_sdkmanager)"
  else
    info "Installing Android command-line tools..."
    case "$PKG_MANAGER" in
      brew)
        pkg_install_cask "android-commandlinetools"
        ANDROID_HOME="/opt/homebrew/share/android-commandlinetools"
        ANDROID_SDK_ROOT="$ANDROID_HOME"
        export ANDROID_HOME ANDROID_SDK_ROOT
        ;;
      *)
        manual "Install Android commandlinetools from https://developer.android.com/studio#command-line-tools-only and unpack under $ANDROID_HOME/cmdline-tools/latest"
        ;;
    esac
  fi

  if ! find_sdkmanager &>/dev/null; then
    fail "sdkmanager still not found under ANDROID_HOME=$ANDROID_HOME"
    exit 1
  fi

  ensure_java_on_path
  info "Accepting Android SDK licenses..."
  yes | run_sdkmanager --licenses >/dev/null || true

  add_to_profile "export ANDROID_HOME=\"$ANDROID_HOME\""
  add_to_profile 'export ANDROID_SDK_ROOT="$ANDROID_HOME"'
  add_to_profile 'export PATH="$ANDROID_HOME/platform-tools:$PATH"'

  ok "Android SDK root: $ANDROID_HOME"
  ok "sdkmanager: $(find_sdkmanager)"
}

install_platforms() {
  install_sdk
  info "Installing platforms;$ANDROID_PLATFORM ..."
  run_sdkmanager "platforms;$ANDROID_PLATFORM"
  if [[ -d "$ANDROID_HOME/platforms/$ANDROID_PLATFORM" ]]; then
    ok "Platform $ANDROID_PLATFORM installed"
  else
    fail "Platform directory missing: $ANDROID_HOME/platforms/$ANDROID_PLATFORM"
    exit 1
  fi
}

install_build_tools() {
  install_sdk
  info "Installing build-tools;$ANDROID_BUILD_TOOLS ..."
  run_sdkmanager "build-tools;$ANDROID_BUILD_TOOLS"
  if [[ -d "$ANDROID_HOME/build-tools/$ANDROID_BUILD_TOOLS" ]]; then
    ok "build-tools $ANDROID_BUILD_TOOLS installed"
  else
    fail "build-tools directory missing: $ANDROID_HOME/build-tools/$ANDROID_BUILD_TOOLS"
    exit 1
  fi
}

install_gradle() {
  if command -v gradle &>/dev/null; then
    ok "gradle already installed: $(gradle -v 2>/dev/null | head -1 || echo unknown)"
    return 0
  fi
  info "Installing gradle (optional — prefer project ./gradlew for builds)..."
  case "$PKG_MANAGER" in
    brew)    brew install gradle ;;
    apt)     pkg_install "gradle" ;;
    dnf)     pkg_install "gradle" ;;
    pacman)  pkg_install "gradle" ;;
    *)       manual "Install Gradle from https://gradle.org/install/ or use an existing wrapper" ;;
  esac
  if command -v gradle &>/dev/null; then
    ok "gradle installed"
  else
    fail "gradle not on PATH"
    exit 1
  fi
}

install_all() {
  install_java
  install_sdk
  install_adb
  install_platforms
  install_build_tools
  ok "All required Android CLI build dependencies installed"
  echo
  echo "Next:"
  echo "  export JAVA_HOME=${JAVA_HOME:-/opt/homebrew/opt/openjdk@17}"
  echo "  export ANDROID_HOME=$ANDROID_HOME"
  echo "  echo \"sdk.dir=\$ANDROID_HOME\" > local.properties"
  echo "  ./gradlew :app:assembleDebug"
}

# =====================================================================
# Dispatch
# =====================================================================

case "$DEP" in
  java)         install_java ;;
  adb|platform-tools) install_adb ;;
  sdk|cmdline-tools|android-sdk) install_sdk ;;
  platforms|platform) install_platforms ;;
  build-tools|build_tools) install_build_tools ;;
  gradle)       install_gradle ;;
  all)          install_all ;;
  *)
    echo "Error: Unknown dependency '$DEP'" >&2
    echo "Available: java, adb, sdk, platforms, build-tools, gradle, all" >&2
    exit 1
    ;;
esac
