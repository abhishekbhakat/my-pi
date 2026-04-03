#!/usr/bin/env bash
set -euo pipefail

# install.sh - Sync .pi config from repo to ~/.pi
# Mirrors repo structure onto target, but does NOT delete extra files
# in target (e.g. node_modules, sessions, auth.json, bin, etc.)
# Works on macOS and Linux.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE="${SCRIPT_DIR}/.pi/agent"
TARGET="${HOME}/.pi/agent"

if [ ! -d "$SOURCE" ]; then
    echo "ERROR: Source directory not found: $SOURCE" >&2
    exit 1
fi

echo "Syncing .pi/agent -> $TARGET"
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
# sync_dir - rsync a subtree, preserving extras in target
# Args: $1=source $2=target $3=label
# -------------------------------------------------------
sync_dir() {
    local src="$1"
    local dst="$2"
    local label="$3"

    if [ ! -d "$src" ]; then
        return
    fi

    echo "[$label]"

    if ! command -v rsync &>/dev/null; then
        echo "  WARNING: rsync not found, falling back to cp"
        mkdir -p "$dst"
        cp -R "$src"/. "$dst"/
        echo "  Files synced."
        ((COPIED++))
        return
    fi

    local output
    output=$(rsync -a --exclude "package-lock.json" "$src/" "$dst/" --out-format="%n" --itemize-changes 2>&1) || true

    if [ -z "$output" ]; then
        echo "  Already up to date."
        ((SKIPPED++))
    else
        local count
        count=$(echo "$output" | grep -c "^" || true)
        echo "  Files synced (${count} items)."
        ((COPIED++))
    fi
    echo ""
}

# -------------------------------------------------------
# sync_root_files - copy individual root-level config files
# -------------------------------------------------------
sync_root_files() {
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

# --- Sync extensions, skills, themes, and root-level files ---

sync_dir "${SOURCE}/extensions" "${TARGET}/extensions" "extensions"
sync_dir "${SOURCE}/skills" "${TARGET}/skills" "skills"
sync_dir "${SOURCE}/themes" "${TARGET}/themes" "themes"
sync_root_files

# --- Sync agents directory (sibling of agent/) ---
AGENTS_SRC="${SCRIPT_DIR}/.pi/agents"
AGENTS_DST="${HOME}/.pi/agents"
if [ -d "$AGENTS_SRC" ]; then
    echo "[agents]"
    mkdir -p "$AGENTS_DST"
    if command -v rsync &>/dev/null; then
        rsync -a --include="*.md" --exclude="*" "$AGENTS_SRC/" "$AGENTS_DST/"
    else
        cp "${AGENTS_SRC}"/*.md "$AGENTS_DST/" 2>/dev/null || true
    fi
    echo "  Done."
    echo ""
fi

echo ""
echo "============================="
echo " Sync complete."
echo " Copied: ${COPIED}"
echo " Skipped: ${SKIPPED}"
echo "============================="
echo ""
echo "Run /reload in pi to pick up changes."
