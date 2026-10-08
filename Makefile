# my-pi — install / sync live ~/.pi config; bun TypeScript `pi`
#
#   make help
#   make install                       (bun pi + config copy + pi update)
#   make install ARGS="-h HOST"        (set models.json proxy host)
#   make install-bun                   (same as install, minus the bun-pi restore step)
#   make restore-bun-pi                (undo the old vendor-installer takeover of `pi`)
#   make config-install                (repo .pi/agent -> ~/.pi/agent only)
#   make sync                          (live ~/.pi/agent -> repo .pi/agent)
#   make sync ARGS="-p"                (also prune repo files missing from live)
#   make setup                         (auto-branch pi-install-<ddmmyyyy> on main)
#   make test-setup                    (Docker setup cases)

SHELL := /bin/sh
.DEFAULT_GOAL := help

CLI := node scripts/pi.mjs

PI_PKG := @earendil-works/pi-coding-agent
BUN_HOME := $(or $(BUN_INSTALL),$(HOME)/.bun)
BUN_BIN := $(BUN_HOME)/bin

.PHONY: help install install-bun restore-bun-pi config-install sync setup test-setup dist release

help:
	@printf '%s\n' \
		'my-pi Makefile' \
		'' \
		'Targets' \
		'  make help                 Show this help (default)' \
		'  make install              Bun pi: setup bun, migrate npm -> bun, copy config,' \
		'                            pi update + pi update --extensions' \
		'  make install-bun          Same as install, minus the bun-pi restore step' \
		'  make restore-bun-pi       Give `pi` back to bun after the old vendor-installer takeover' \
		'  make config-install       Copy repo .pi/agent -> ~/.pi/agent only' \
		'  make sync                 Copy live ~/.pi/agent -> repo .pi/agent' \
		'  make setup                Interactive provider/auth bootstrap; writes userprofile.patch' \
		'  make test-setup           Build Docker image from filtered tar; run setup cases' \
		'  make dist                  Build pi-setup binaries with embedded snapshot' \
		'  make release               Publish a GitHub release: snapshot + binaries' \
		'' \
		'Pass-through flags via ARGS=' \
		'  make install ARGS="-h HOST"         set models.json proxy host' \
		'  make config-install ARGS="-h HOST"  same, config copy only' \
		'  make sync ARGS="-p"                 prune repo files missing from live' \
		'  make setup ARGS="--help"            setup usage' \
		'  make install ARGS="--no-profile"    skip userprofile.patch' \
		'  make test-setup ARGS="00-harness"   run one Docker case' \
		'' \
		'Or call Node directly (same on macOS, Linux, Windows):' \
		'  node scripts/pi.mjs install [--config-only] [-h HOST]' \
		'  node scripts/pi.mjs sync [-p]' \
		'  node scripts/pi.mjs setup --create-branch NAME' \
		'' \
		'Notes' \
		'  `pi` is the bun global TypeScript CLI; config lives under ~/.pi/agent.' \
		'  auth.json: api_key merge both ways; oauth home -> repo on sync only.' \
		'  After install, run /reload or /restart inside pi.' \
		'  setup needs a TTY; writes userprofile.patch (gitignored), restores tracked .pi/agent.' \
		'  install applies userprofile.patch in temp staging; on failure run make setup again.' \
		'  setup never writes ~/.pi; run make install to apply userprofile.patch.' \
		'  test-setup needs Docker; never mounts host repo; secrets excluded by .gitignore.'

install: restore-bun-pi install-bun
	@printf '%s\n' \
		'' \
		'Install complete.' \
		'  pi:  bun TypeScript CLI ($(BUN_BIN)/pi)' \
		'  Run /reload or /restart inside pi.'

install-bun:
	$(CLI) install $(ARGS)

# An earlier `make install` ran the vendor installer with --adopt: it replaced
# bun's `pi` with the Rust binary, kept the TypeScript CLI only as `legacy-pi`,
# and wrote Rust zsh completions for `pi`. Undo that layout. Idempotent; only
# removes Rust pi binaries and files the vendor installer wrote.
restore-bun-pi:
	@is_rust_pi() { [ -f "$$1" ] && [ ! -L "$$1" ] && "$$1" --version 2>/dev/null | head -1 | grep -Eq '^pi [0-9]+\.[0-9]+\.[0-9]+ \('; }; \
	for bin in "$(HOME)/.local/bin/pi" "$(BUN_BIN)/pi"; do \
	  if is_rust_pi "$$bin"; then rm -f "$$bin" && echo "Removed Rust pi: $$bin"; fi; \
	done; \
	for f in rpi legacy-pi; do \
	  if grep -qs 'pi_agent_rust installer managed alias' "$(BUN_BIN)/$$f"; then \
	    rm -f "$(BUN_BIN)/$$f" && echo "Removed vendor installer wrapper: $(BUN_BIN)/$$f"; \
	  fi; \
	done; \
	if [ -L "$(BUN_BIN)/.pi-legacy-typescript" ]; then \
	  if [ -e "$(BUN_BIN)/pi" ] || [ -L "$(BUN_BIN)/pi" ]; then rm -f "$(BUN_BIN)/.pi-legacy-typescript"; \
	  else mv "$(BUN_BIN)/.pi-legacy-typescript" "$(BUN_BIN)/pi" && echo "Restored bun pi link: $(BUN_BIN)/pi"; fi; \
	fi; \
	pkg="$(BUN_HOME)/install/global/node_modules/$(PI_PKG)"; \
	if [ ! -e "$(BUN_BIN)/pi" ] && [ ! -L "$(BUN_BIN)/pi" ] && [ -f "$$pkg/package.json" ]; then \
	  entry=$$(node -e 'const b = require(process.argv[1]).bin; const e = typeof b === "string" ? b : b && b.pi; if (!e) process.exit(1); console.log(e)' "$$pkg/package.json") && \
	  ln -s "../install/global/node_modules/$(PI_PKG)/$$entry" "$(BUN_BIN)/pi" && echo "Linked bun pi: $(BUN_BIN)/pi"; \
	fi; \
	comp="$${XDG_DATA_HOME:-$$HOME/.local/share}/zsh/site-functions/_pi"; \
	if head -1 "$$comp" 2>/dev/null | grep -qx '#compdef pi' && grep -q 'is-at-least' "$$comp"; then \
	  rm -f "$$comp" && echo "Removed Rust pi zsh completions: $$comp"; \
	fi; \
	state="$${XDG_STATE_HOME:-$$HOME/.local/state}/pi-agent-rust/install-state.env"; \
	if grep -qs '^# pi_agent_rust installer state' "$$state"; then \
	  rm -f "$$state" && echo "Removed vendor installer state: $$state"; \
	fi

config-install:
	$(CLI) install --config-only $(ARGS)

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

dist:
	node scripts/dist/build.mjs $(ARGS)

# Clean tree + pushed HEAD, build all default targets, publish a GitHub
# release (v<sha> tag, snapshot + binaries) via scripts/dist/release.mjs.
# Binary users update with `pi-setup update`; the tag doubles as version.
release:
	node scripts/dist/release.mjs $(ARGS)
