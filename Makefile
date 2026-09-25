# my-pi — install / sync live ~/.pi config
#
#   make help
#   make install
#   make install ARGS="-h localhost"
#   make sync
#   make sync ARGS="-p"
#   make setup                                (auto-branch pi-install-<ddmmyyyy> on main)

SHELL := /bin/sh
.DEFAULT_GOAL := help

CLI := node scripts/pi.mjs

.PHONY: help install sync setup test-setup

help:
	@printf '%s\n' \
		'my-pi Makefile' \
		'' \
		'Targets' \
		'  make help                 Show this help (default)' \
		'  make install              Setup bun if missing; migrate pi CLI npm -> bun; copy config;' \
		'                            run pi update and pi update --extensions' \
		'  make sync                 Copy live ~/.pi/agent -> repo .pi/agent' \
		'  make setup                Interactive provider/auth bootstrap on a local git branch' \
		'  make test-setup           Build Docker image from filtered tar; run setup cases' \
		'' \
		'Pass-through flags via ARGS=' \
		'  make install ARGS="-h HOST"         set models.json proxy host' \
		'  make sync ARGS="-p"                 prune repo files missing from live' \
		'  make setup ARGS="--create-branch NAME"' \
		'                                      pin branch name; plain make setup auto-creates pi-install-<ddmmyyyy>' \
		'  make setup ARGS="--help"            setup usage' \
		'  make test-setup ARGS="00-harness"  run one Docker case' \
		'' \
		'Or call Node directly (same on macOS, Linux, Windows):' \
		'  node scripts/pi.mjs install' \
		'  node scripts/pi.mjs sync' \
		'  node scripts/pi.mjs setup --create-branch NAME' \
		'' \
		'Notes' \
		'  auth.json: api_key merge both ways; oauth home -> repo on sync only.' \
		'  After install, run /reload or /restart inside pi.' \
		'  Install also updates the pi CLI and installed packages.' \
		'  setup needs a TTY; refuses on main/master/detached unless --create-branch NAME.' \
		'  setup writes repo .pi/agent only; never ~/.pi except via its optional install.' \
		'  test-setup needs Docker; never mounts host repo; secrets excluded by .gitignore.'

install:
	$(CLI) install $(ARGS)

sync:
	$(CLI) sync $(ARGS)

setup:
	$(CLI) setup $(ARGS)

test-setup:
	@git ls-files -z -c -- '*auth.json' ':!tests/setup/fixtures/**' \
	  | xargs -0 sh -c 'if [ "$$#" -gt 0 ]; then echo "ERROR: tracked auth file(s) would enter Docker context: $$*" >&2; exit 1; fi' _
	@set -e; \
	CTX=$$(mktemp -d); LIST=$$(mktemp); \
	trap 'rm -rf "$$CTX" "$$LIST"' EXIT; \
	{ git ls-files -z -co --exclude-standard; git ls-files -z -o -i --exclude-standard -- tests/; } \
	  | xargs -0 sh -c 'for f; do case "$$f" in */._*|._*|*/.DS_Store|.DS_Store|*/__pycache__/*|*.tmp) continue;; esac; case "$$f" in *auth.json) case "$$f" in tests/setup/fixtures/*) ;; *) echo "ERROR: auth path in context: $$f" >&2; exit 1;; esac;; esac; if [ -e "$$f" ]; then printf "%s\\0" "$$f"; fi; done' _ >"$$LIST"; \
	COPYFILE_DISABLE=1 tar --null --no-recursion -T "$$LIST" -cf - | tar -C "$$CTX" -xf -; \
	[ -f "$$CTX/tests/setup/Dockerfile" ] || { echo "ERROR: tests/setup/Dockerfile missing from context" >&2; exit 1; }; \
	docker build -t my-pi-setup-test -f "$$CTX/tests/setup/Dockerfile" "$$CTX"; \
	docker run --rm --network none my-pi-setup-test $(ARGS)
