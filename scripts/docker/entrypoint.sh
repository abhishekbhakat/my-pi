#!/bin/sh
# Prepare a clean HOME with my-pi config, optional auth, and packages.
# Then exec the container command (smoke test, pi, shell, ...).
set -eu

cd /workspace
DOCKER_SCRIPTS=/workspace/scripts/docker

echo "== docker entrypoint: make install =="
make install

AUTH_DEST="${HOME}/.pi/agent/auth.json"
mkdir -p "${HOME}/.pi/agent"

# Prefer explicit secret mount, then host-style path mount.
if [ -f /secrets/auth.json ]; then
	echo "== docker entrypoint: merge /secrets/auth.json =="
	node "$DOCKER_SCRIPTS/merge-auth.mjs" /secrets/auth.json "$AUTH_DEST"
elif [ -f /auth.json ]; then
	echo "== docker entrypoint: merge /auth.json =="
	node "$DOCKER_SCRIPTS/merge-auth.mjs" /auth.json "$AUTH_DEST"
fi

# Env-key helpers for providers used in this branch.
if [ -n "${COMMANDCODE_API_KEY:-}" ] || [ -n "${CMD_API_KEY:-}" ]; then
	echo "== docker entrypoint: apply COMMANDCODE_API_KEY =="
	KEY="${COMMANDCODE_API_KEY:-$CMD_API_KEY}"
	COMMANDCODE_API_KEY="$KEY" node "$DOCKER_SCRIPTS/merge-auth.mjs" --commandcode-env "$AUTH_DEST"
fi

if [ -n "${VENICE_API_KEY:-}" ]; then
	echo "== docker entrypoint: apply VENICE_API_KEY =="
	VENICE_API_KEY="$VENICE_API_KEY" node "$DOCKER_SCRIPTS/merge-auth.mjs" --venice-env "$AUTH_DEST"
fi

# Install packages declared in settings (needs network).
if command -v pi >/dev/null 2>&1; then
	echo "== docker entrypoint: install packages =="
	# Offline-friendly: skip when PI_OFFLINE=1 or no network desired.
	if [ "${PI_OFFLINE:-0}" != "1" ]; then
		node "$DOCKER_SCRIPTS/install-packages.mjs" || {
			echo "WARNING: package install had errors (models from packages may be missing)" >&2
		}
	else
		echo "  skip packages (PI_OFFLINE=1)"
	fi
fi

echo "== docker entrypoint: ready =="
exec "$@"
