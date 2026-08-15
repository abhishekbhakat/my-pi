# my-pi — install / sync live ~/.pi config
#
#   make help
#   make install
#   make install ARGS="-h localhost"
#   make sync
#   make sync ARGS="-p"

SHELL := /bin/sh
.DEFAULT_GOAL := help

CLI := node scripts/pi.mjs

.PHONY: help install sync

help:
	@printf '%s\n' \
		'my-pi Makefile' \
		'' \
		'Targets' \
		'  make help                 Show this help (default)' \
		'  make install              Copy repo .pi/agent -> ~/.pi/agent' \
		'  make sync                 Copy live ~/.pi/agent -> repo .pi/agent' \
		'' \
		'Pass-through flags via ARGS=' \
		'  make install ARGS="-h HOST"         set models.json proxy host' \
		'  make sync ARGS="-p"                 prune repo files missing from live' \
		'' \
		'Or call Node directly (same on macOS, Linux, Windows):' \
		'  node scripts/pi.mjs install' \
		'  node scripts/pi.mjs sync' \
		'' \
		'Notes' \
		'  auth.json is merge-only both ways: incoming keys override, dest-only keys stay.' \
		'  After install, run /reload or /restart inside pi.'

install:
	$(CLI) install $(ARGS)

sync:
	$(CLI) sync $(ARGS)
