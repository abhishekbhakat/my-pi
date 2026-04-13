#!/usr/bin/env bash
set -euo pipefail

# install.sh - Copy .pi config from repo to ~/.pi
# Replaces each target subtree before copying, so stale files do not linger.
# Works on macOS and Linux.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE="${SCRIPT_DIR}/.pi/agent"
TARGET="${HOME}/.pi/agent"

if [ ! -d "$SOURCE" ]; then
    echo "ERROR: Source directory not found: $SOURCE" >&2
    exit 1
fi

echo "Copying .pi/agent -> $TARGET"
echo ""

# Files to never overwrite (user-specific config that may differ from repo)
PROTECTED_FILES=(settings.json models.json damage-control-rules.yaml SYSTEM.md PREREQS.md)

# Ask about protected files
read -rp "Overwrite protected config files (settings.json, models.json, etc.)? [y/N]: " overwrite
OVERWRITE_PROTECTED=false
if [[ "$overwrite" =~ ^[Yy]$ ]]; then
    OVERWRITE_PROTECTED=true
    echo "  Will overwrite protected files."
else
    echo "  Will skip protected files."
fi
echo ""

mkdir -p "$TARGET"

COPIED=0
SKIPPED=0

# -------------------------------------------------------
# copy_dir - replace a subtree, then copy source contents into it
# Args: $1=source $2=target $3=label
# -------------------------------------------------------
copy_dir() {
    local src="$1"
    local dst="$2"
    local label="$3"

    if [ ! -d "$src" ]; then
        return
    fi

    echo "[$label]"

    rm -rf "$dst"
    mkdir -p "$dst"
    cp -R "$src"/. "$dst"/
    find "$dst" -name "package-lock.json" -type f -exec rm -f {} +
    echo "  Files copied."
    ((COPIED++))
    echo ""
}

# -------------------------------------------------------
# copy_root_files - copy individual root-level config files
# -------------------------------------------------------
copy_root_files() {
    echo "[root files]"
    for file in "${PROTECTED_FILES[@]}"; do
        if [ -f "${SOURCE}/${file}" ]; then
            local is_protected=false
            for p in "${PROTECTED_FILES[@]}"; do
                if [ "$file" = "$p" ]; then
                    is_protected=true
                    break
                fi
            done

            if $is_protected && ! $OVERWRITE_PROTECTED; then
                echo "  Skipping $file (protected)"
                ((SKIPPED++))
            else
                cp -f "${SOURCE}/${file}" "${TARGET}/${file}"
                echo "  Copied $file"
                ((COPIED++))
            fi
        fi
    done
    echo ""
}

# --- Copy extensions, skills, themes, and root-level files ---

copy_dir "${SOURCE}/extensions" "${TARGET}/extensions" "extensions"
copy_dir "${SOURCE}/skills" "${TARGET}/skills" "skills"
copy_dir "${SOURCE}/themes" "${TARGET}/themes" "themes"
copy_root_files

# --- Copy agents directory (sibling of agent/) ---
AGENTS_SRC="${SCRIPT_DIR}/.pi/agents"
AGENTS_DST="${HOME}/.pi/agents"
if [ -d "$AGENTS_SRC" ]; then
    echo "[agents]"
    rm -rf "$AGENTS_DST"
    mkdir -p "$AGENTS_DST"
    if compgen -G "$AGENTS_SRC/*.md" > /dev/null; then
        cp "$AGENTS_SRC"/*.md "$AGENTS_DST/"
    fi
    echo "  Done."
    echo ""
fi

echo ""
echo "============================="
echo " Copy complete."
echo " Copied: ${COPIED}"
echo " Skipped: ${SKIPPED}"
echo "============================="
echo ""
echo "Run /reload in pi to pick up changes."
