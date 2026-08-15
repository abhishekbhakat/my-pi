#!/usr/bin/env bash
set -euo pipefail

# sync.sh - Copy live ~/.pi config into this repo
# Reverse of install.sh. Content-aware: only writes when LF-normalized bytes differ,
# so identical files keep their mtimes and Git stays clean. Skips runtime/secrets and
# git submodules. Text files are normalized to LF (CRLF ignored).
# Works on macOS and Linux.
#
# Default is additive: update/add from live, never delete repo-only files.
# The repo is the edit source of truth; live can lag or be partially wiped.
# Pass -p/--prune only when you intentionally want a live mirror.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE="${HOME}/.pi/agent"
TARGET="${SCRIPT_DIR}/.pi/agent"
REPO_ROOT="$SCRIPT_DIR"

ASSUME_YES=false
PRUNE=false

usage() {
    cat <<EOF
Usage: $(basename "$0") [-y] [-p]

Options:
  -y        Sync without prompting; overwrite protected config files in the repo.
  -p        Prune: delete repo files missing from live (mirror mode). Off by default.

Copies ~/.pi/agent -> .pi/agent (extensions, skills, themes, root config).
Also copies ~/.pi/agents/*.md when present.
Skips auth.json, bin/, sessions/, node_modules, package-lock.json, git submodules.
Only rewrites a file when LF-normalized content actually changed.
Default is additive (no deletes). Use -p only to mirror-delete.
EOF
}

while getopts ":yph" opt; do
    case "$opt" in
        y) ASSUME_YES=true ;;
        p) PRUNE=true ;;
        h) usage; exit 0 ;;
        :)
            echo "ERROR: Option -$OPTARG requires an argument." >&2
            usage >&2
            exit 1
            ;;
        \?)
            echo "ERROR: Unknown option -$OPTARG" >&2
            usage >&2
            exit 1
            ;;
    esac
done
shift $((OPTIND - 1))

if [ "$#" -gt 0 ]; then
    echo "ERROR: Unexpected argument: $1" >&2
    usage >&2
    exit 1
fi

if [ ! -d "$SOURCE" ]; then
    echo "ERROR: Live source directory not found: $SOURCE" >&2
    exit 1
fi

echo "Syncing ${SOURCE} -> .pi/agent"
echo ""

PROTECTED_FILES=(settings.json models.json models-store.json damage-control-rules.yaml SYSTEM.md PREREQS.md)
ROOT_FILES=(settings.json models.json models-store.json damage-control-rules.yaml SYSTEM.md PREREQS.md)
MANAGED_DIRS=(extensions skills themes)

OVERWRITE_PROTECTED=false
if $ASSUME_YES; then
    OVERWRITE_PROTECTED=true
    echo "  -y provided; will overwrite protected files in the repo."
else
    read -rp "Overwrite protected config files in the repo (settings.json, models.json, etc.)? [y/N]: " overwrite
    if [[ "$overwrite" =~ ^[Yy]$ ]]; then
        OVERWRITE_PROTECTED=true
        echo "  Will overwrite protected files."
    else
        echo "  Will skip protected files."
    fi
fi
echo ""

mkdir -p "$TARGET"

COPIED=0
SKIPPED=0
UPDATED=0
REMOVED=0
UNCHANGED=0

# -------------------------------------------------------
# Load submodule paths from .gitmodules (relative, /-separated)
# -------------------------------------------------------
SUBMODULE_PATHS=()
if [ -f "${REPO_ROOT}/.gitmodules" ]; then
    while IFS= read -r line; do
        case "$line" in
            [[:space:]]path[[:space:]]=*)
                p="${line#*=}"
                p="$(printf '%s' "$p" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
                SUBMODULE_PATHS+=("$p")
                ;;
        esac
    done < "${REPO_ROOT}/.gitmodules"
fi

repo_rel() {
    local full="$1"
    local root="${REPO_ROOT}/"
    full="$(cd "$(dirname "$full")" && pwd)/$(basename "$full")"
    if [[ "$full" == "$root"* ]]; then
        printf '%s\n' "${full#"$root"}"
    else
        printf '%s\n' "$full"
    fi
}

is_under_submodule() {
    local full="$1"
    local rel
    rel="$(repo_rel "$full")"
    local sub
    for sub in "${SUBMODULE_PATHS[@]+"${SUBMODULE_PATHS[@]}"}"; do
        if [ "$rel" = "$sub" ] || [[ "$rel" == "$sub/"* ]]; then
            return 0
        fi
    done
    return 1
}

is_text_path() {
    local path="$1"
    local base ext
    base="$(basename "$path")"
    ext="$(printf '%s' "$base" | awk -F. '{if (NF>1) print tolower($NF); else print ""}')"
    case "$base" in
        LICENSE|README|Makefile|Makefile.*|.gitignore|.gitattributes|.npmrc|.editorconfig)
            return 0
            ;;
    esac
    case "$ext" in
        ts|js|mjs|cjs|json|md|yaml|yml|txt|css|html|htm|svg|xml|sh|bash|zsh|ps1|bat|cmd|py|toml|ini|cfg|conf)
            return 0
            ;;
    esac
    return 1
}

# Write LF-normalized content from src to dst only if bytes differ.
# Returns 0 if updated, 1 if unchanged.
write_if_changed() {
    local src="$1"
    local dst="$2"
    local tmp normalized_src

    mkdir -p "$(dirname "$dst")"

    tmp="$(mktemp "${TMPDIR:-/tmp}/pi-sync.XXXXXX")"
    if is_text_path "$src" && grep -Iq . "$src" 2>/dev/null; then
        # strip CR
        tr -d '\r' < "$src" > "$tmp"
    else
        cp -f "$src" "$tmp"
    fi

    if [ -f "$dst" ] && cmp -s "$tmp" "$dst"; then
        rm -f "$tmp"
        UNCHANGED=$((UNCHANGED + 1))
        return 1
    fi

    mv -f "$tmp" "$dst"
    UPDATED=$((UPDATED + 1))
    return 0
}

should_skip_rel() {
    local rel="$1"
    local base
    base="$(basename "$rel")"
    case "$base" in
        package-lock.json|auth.json) return 0 ;;
    esac
    case "/$rel/" in
        */node_modules/*|*/.git/*) return 0 ;;
    esac
    return 1
}

sync_dir() {
    local src="$1"
    local dst="$2"
    local label="$3"

    if [ ! -d "$src" ]; then
        return
    fi

    echo "[$label]"

    if is_under_submodule "$dst"; then
        echo "  Skipping (git submodule)."
        echo ""
        return
    fi

    mkdir -p "$dst"

    # Collect source relative paths
    local -a src_rels=()
    local f rel
    while IFS= read -r -d '' f; do
        rel="${f#"$src"/}"
        if should_skip_rel "$rel"; then
            continue
        fi
        if is_under_submodule "$dst/$rel"; then
            continue
        fi
        # Skip files living inside a nested git checkout that maps to a submodule
        local walk="$f"
        local skip=false
        while [ "$walk" != "$src" ] && [ "$walk" != "/" ]; do
            walk="$(dirname "$walk")"
            if [ -e "$walk/.git" ]; then
                local walk_rel="${walk#"$src"/}"
                if [ "$walk" = "$src" ]; then
                    break
                fi
                if is_under_submodule "$dst/$walk_rel"; then
                    skip=true
                    break
                fi
            fi
        done
        if $skip; then
            continue
        fi
        src_rels+=("$rel")
        if write_if_changed "$src/$rel" "$dst/$rel"; then
            :
        fi
    done < <(find "$src" -type f -print0 2>/dev/null)

    # Optional mirror: remove dest files not in source.
    # Off by default so repo-only work is never wiped when live lags.
    if $PRUNE; then
        local -A src_set=()
        for rel in "${src_rels[@]+"${src_rels[@]}"}"; do
            src_set["$rel"]=1
        done

        while IFS= read -r -d '' f; do
            rel="${f#"$dst"/}"
            if should_skip_rel "$rel"; then
                continue
            fi
            if is_under_submodule "$f"; then
                continue
            fi
            if [ -z "${src_set[$rel]+x}" ]; then
                rm -f "$f"
                REMOVED=$((REMOVED + 1))
            fi
        done < <(find "$dst" -type f -print0 2>/dev/null)

        # Prune empty directories (never submodule roots)
        find "$dst" -depth -type d -empty 2>/dev/null | while IFS= read -r d; do
            if is_under_submodule "$d"; then
                continue
            fi
            rmdir "$d" 2>/dev/null || true
        done
    fi

    echo "  Done."
    COPIED=$((COPIED + 1))
    echo ""
}

for dir in "${MANAGED_DIRS[@]}"; do
    sync_dir "${SOURCE}/${dir}" "${TARGET}/${dir}" "$dir"
done

echo "[root files]"
for file in "${ROOT_FILES[@]}"; do
    if [ ! -f "${SOURCE}/${file}" ]; then
        continue
    fi
    is_protected=false
    for p in "${PROTECTED_FILES[@]}"; do
        if [ "$file" = "$p" ]; then
            is_protected=true
            break
        fi
    done
    if $is_protected && ! $OVERWRITE_PROTECTED; then
        echo "  Skipping $file (protected)"
        SKIPPED=$((SKIPPED + 1))
        continue
    fi
    if write_if_changed "${SOURCE}/${file}" "${TARGET}/${file}"; then
        echo "  Updated $file"
    else
        echo "  Unchanged $file"
    fi
done
echo ""

AGENTS_SRC="${HOME}/.pi/agents"
AGENTS_DST="${REPO_ROOT}/.pi/agents"
if [ -d "$AGENTS_SRC" ]; then
    echo "[agents]"
    mkdir -p "$AGENTS_DST"
    if compgen -G "$AGENTS_SRC/*.md" > /dev/null; then
        for f in "$AGENTS_SRC"/*.md; do
            base="$(basename "$f")"
            if write_if_changed "$f" "${AGENTS_DST}/${base}"; then
                echo "  Updated $base"
            else
                echo "  Unchanged $base"
            fi
        done
    else
        echo "  No .md files found."
    fi
    echo "  Done."
    echo ""
fi

echo ""
echo "============================="
echo " Sync complete."
echo " Dirs synced: ${COPIED}"
echo " Files updated: ${UPDATED}"
echo " Files unchanged: ${UNCHANGED}"
if $PRUNE; then
    echo " Files removed: ${REMOVED}"
else
    echo " Files removed: 0 (pass -p to delete repo files missing from live)"
fi
echo " Protected skipped: ${SKIPPED}"
echo "============================="
echo ""
echo "Skipped: auth.json, bin/, sessions/, node_modules, package-lock.json, git submodules"
echo "Text files normalized to LF (CRLF ignored)."
echo "Default is additive (no deletes). Use -p only to mirror-delete."
echo "Review git status, then commit if the repo should keep these changes."
