# my-pi — install / sync live ~/.pi config
#
#   make help
#   make install
#   make install ARGS="-h localhost"
#   make sync
#   make sync ARGS="-p"
#   make docker-test

SHELL := /bin/sh
.DEFAULT_GOAL := help

CLI := node scripts/pi.mjs
DOCKER_DIR := scripts/docker
DOCKER_IMAGE ?= my-pi-test
# Optional auth for interactive docker-run (never baked into image).
#   make docker-run COMMANDCODE_API_KEY=cc_...
#   make docker-run AUTH_FILE=$HOME/.pi/agent/auth.json
COMMANDCODE_API_KEY ?=
CMD_API_KEY ?=
AUTH_FILE ?=
DOCKER_RUN_ARGS ?=

.PHONY: help install sync docker-test docker-build docker-run docker-models

help:
	@printf '%s\n' \
		'my-pi Makefile' \
		'' \
		'Targets' \
		'  make help                 Show this help (default)' \
		'  make install              Copy repo .pi/agent -> ~/.pi/agent' \
		'  make sync                 Copy live ~/.pi/agent -> repo .pi/agent' \
		'  make docker-test          Build image and smoke-test install in Docker' \
		'  make docker-build         Build Docker image only' \
		'  make docker-run           Interactive pi in Docker (needs auth)' \
		'  make docker-models        List models inside Docker (needs auth)' \
		'' \
		'Pass-through flags via ARGS=' \
		'  make install ARGS="-h HOST"         set models.json proxy host' \
		'  make sync ARGS="-p"                 prune repo files missing from live' \
		'' \
		'Docker auth (pick one)' \
		'  make docker-run COMMANDCODE_API_KEY=cc_...' \
		'  make docker-run AUTH_FILE=$$HOME/.pi/agent/auth.json' \
		'' \
		'Or call Node directly (same on macOS, Linux, Windows):' \
		'  node scripts/pi.mjs install' \
		'  node scripts/pi.mjs sync' \
		'' \
		'Notes' \
		'  auth.json is merge-only both ways: incoming keys override, dest-only keys stay.' \
		'  After install, run /reload or /restart inside pi.' \
		'  Docker files live under scripts/docker/ (build context stays repo root).' \
		'  Repo .pi/agent/auth.json is copied into the image when present (gitignored).' \
		'  Optional runtime override: COMMANDCODE_API_KEY=... or AUTH_FILE=...'

install:
	$(CLI) install $(ARGS)

sync:
	$(CLI) sync $(ARGS)

docker-build:
	docker build -f $(DOCKER_DIR)/Dockerfile -t $(DOCKER_IMAGE) .

docker-test: docker-build
	docker run --rm $(DOCKER_IMAGE)

# Build docker run flags for auth without printing secrets.
define DOCKER_AUTH_FLAGS
$(if $(AUTH_FILE),-v $(AUTH_FILE):/secrets/auth.json:ro,) \
$(if $(COMMANDCODE_API_KEY),-e COMMANDCODE_API_KEY=$(COMMANDCODE_API_KEY),) \
$(if $(CMD_API_KEY),-e CMD_API_KEY=$(CMD_API_KEY),)
endef

docker-run: docker-build
	docker run --rm -it $(DOCKER_AUTH_FLAGS) $(DOCKER_RUN_ARGS) $(DOCKER_IMAGE) pi

docker-models: docker-build
	docker run --rm $(DOCKER_AUTH_FLAGS) $(DOCKER_RUN_ARGS) $(DOCKER_IMAGE) pi --list-models
