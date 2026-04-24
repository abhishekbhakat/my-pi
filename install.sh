#!/usr/bin/env bash
set -euo pipefail

# install.sh - Copy .pi config from repo to ~/.pi
# Replaces each target subtree before copying, so stale files do not linger.
# Works on macOS and Linux.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE="${SCRIPT_DIR}/.pi/agent"
TARGET="${HOME}/.pi/agent"

ASSUME_YES=false
PROXY_HOST="localhost"
PROXY_HOST_PROVIDED=false

usage() {
    cat <<EOF
Usage: $(basename "$0") [-y] [-h host]

Options:
  -y        Install without prompting; overwrite protected config files.
  -h host   Proxy host for models.json. Defaults to localhost.
            A bare host uses port 8383. host:port and full URLs are accepted.
EOF
}

normalize_proxy_origin() {
    local host="$1"

    while [[ "$host" == */ ]]; do
        host="${host%/}"
    done
    if [[ "$host" == */v1 ]]; then
        host="${host%/v1}"
        while [[ "$host" == */ ]]; do
            host="${host%/}"
        done
    fi

    if [[ "$host" == http://* || "$host" == https://* ]]; then
        printf '%s\n' "$host"
    elif [[ "$host" == *:* ]]; then
        printf 'http://%s\n' "$host"
    else
        printf 'http://%s:8383\n' "$host"
    fi
}

while getopts ":yh:" opt; do
    case "$opt" in
        y)
            ASSUME_YES=true
            ;;
        h)
            PROXY_HOST="$OPTARG"
            PROXY_HOST_PROVIDED=true
            ;;
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

if [ -z "$PROXY_HOST" ]; then
    echo "ERROR: -h requires a non-empty host." >&2
    exit 1
fi

case "$PROXY_HOST" in
    *[[:space:]]*|*\"*|*\\*)
        echo "ERROR: Proxy host must not contain whitespace, double quotes, or backslashes." >&2
        exit 1
        ;;
esac

PROXY_ORIGIN="$(normalize_proxy_origin "$PROXY_HOST")"

if [ -z "$PROXY_ORIGIN" ] || [ "$PROXY_ORIGIN" == "http://:8383" ]; then
    echo "ERROR: Invalid proxy host '$PROXY_HOST'." >&2
    exit 1
fi

if [ ! -d "$SOURCE" ]; then
    echo "ERROR: Source directory not found: $SOURCE" >&2
    exit 1
fi

echo "Copying .pi/agent -> $TARGET"
echo ""

# Files to never overwrite (user-specific config that may differ from repo)
PROTECTED_FILES=(settings.json models.json damage-control-rules.yaml SYSTEM.md PREREQS.md)

# Ask about protected files unless -y was provided.
OVERWRITE_PROTECTED=false
if $ASSUME_YES; then
    OVERWRITE_PROTECTED=true
    echo "  -y provided; will overwrite protected files."
else
    read -rp "Overwrite protected config files (settings.json, models.json, etc.)? [y/N]: " overwrite
    if [[ "$overwrite" =~ ^[Yy]$ ]]; then
        OVERWRITE_PROTECTED=true
        echo "  Will overwrite protected files."
    else
        echo "  Will skip protected files."
    fi
fi

if $PROXY_HOST_PROVIDED; then
    echo "  Will set models.json proxy origin to ${PROXY_ORIGIN}."
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
    ((COPIED+=1))
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
                ((SKIPPED+=1))
            else
                cp -f "${SOURCE}/${file}" "${TARGET}/${file}"
                echo "  Copied $file"
                ((COPIED+=1))
            fi
        fi
    done
    echo ""
}

# --- Copy extensions, skills, themes, and root-level files ---

copy_dir "${SOURCE}/extensions" "${TARGET}/extensions" "extensions"

# -------------------------------------------------------
# npm_install_extensions - run npm install in extensions dir
# -------------------------------------------------------
npm_install_extensions() {
    local ext_dir="${TARGET}/extensions"
    if [ ! -f "${ext_dir}/package.json" ]; then
        return
    fi
    if ! command -v npm >/dev/null 2>&1; then
        echo "[extensions npm]"
        echo "  npm not found; skipping npm install."
        echo ""
        return
    fi
    echo "[extensions npm]"
    if (cd "$ext_dir" && npm install) >/dev/null 2>&1; then
        echo "  npm install complete."
    else
        echo "  WARNING: npm install failed."
    fi
    echo ""
}

npm_install_extensions

copy_dir "${SOURCE}/skills" "${TARGET}/skills" "skills"
copy_dir "${SOURCE}/themes" "${TARGET}/themes" "themes"
copy_root_files

# -------------------------------------------------------
# patch_models_json - update target models.json proxy host
# -------------------------------------------------------
patch_models_json() {
    if ! $PROXY_HOST_PROVIDED; then
        return
    fi

    local models_file="${TARGET}/models.json"
    local tmp_file

    echo "[models proxy]"
    if [ ! -f "$models_file" ]; then
        echo "  Skipping proxy update; models.json not found."
        echo ""
        return
    fi

    tmp_file="$(mktemp "${models_file}.XXXXXX")"
    if awk -v origin="$PROXY_ORIGIN" '
        /"baseUrl"[[:space:]]*:/ {
            line = $0
            suffix = (line ~ /\/v1"/) ? "/v1" : ""
            if (match(line, /"baseUrl"[[:space:]]*:[[:space:]]*"[^"]*"/)) {
                $0 = substr(line, 1, RSTART - 1) "\"baseUrl\": \"" origin suffix "\"" substr(line, RSTART + RLENGTH)
            }
        }
        { print }
    ' "$models_file" > "$tmp_file"; then
        mv "$tmp_file" "$models_file"
        echo "  Updated models.json proxy origin to ${PROXY_ORIGIN}."
    else
        rm -f "$tmp_file"
        echo "  ERROR: Failed to update models.json proxy origin." >&2
        exit 1
    fi
    echo ""
}

patch_models_json

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
