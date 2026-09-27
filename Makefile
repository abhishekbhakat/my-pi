# my-pi — install / sync live ~/.pi config; bun TypeScript `pi` + Rust `rpi`
#
#   make help
#   make install                       (bun pi + config copy + pi update)
#   make install ARGS="-h HOST"        (set models.json proxy host)
#   make install-bun                   (same as install, minus the bun-pi restore step)
#   make rpi-install                   (ensure toolchain; build + install Rust rpi)
#   make rust-toolchain                (ensure cargo via rustup)
#   make rust-install                  (build + install Rust rpi only)
#   make rust-uninstall                (remove Rust rpi)
#   make restore-bun-pi                (undo the old vendor-installer takeover of `pi`)
#   make config-install                (repo .pi/agent -> ~/.pi/agent only)
#   make sync                          (live ~/.pi/agent -> repo .pi/agent)
#   make sync ARGS="-p"                (also prune repo files missing from live)
#   make setup                         (auto-branch pi-install-<ddmmyyyy> on main)
#   make test-setup                    (Docker setup cases)

SHELL := /bin/sh
.DEFAULT_GOAL := help

CLI := node scripts/pi.mjs

PI_RUST_DIR := vendor/pi_agent_rust
PI_PKG := @earendil-works/pi-coding-agent
BUN_HOME := $(or $(BUN_INSTALL),$(HOME)/.bun)
BUN_BIN := $(BUN_HOME)/bin
RPI_DEST ?= $(HOME)/.local/bin
RPI_BIN := $(RPI_DEST)/rpi

# rustup shims: ~/.cargo/bin (rustup.rs install) and/or brew keg path (brew rustup
# keeps cargo/rustc proxies in its opt dir, unlinked from /opt/homebrew/bin).
RUSTUP_BIN := $(shell brew --prefix rustup 2>/dev/null)/bin
export PATH := $(HOME)/.cargo/bin:$(RUSTUP_BIN):$(PATH)

.PHONY: help install install-bun restore-bun-pi rpi-install rust-toolchain rust-install rust-uninstall config-install sync setup test-setup

help:
	@printf '%s\n' \
		'my-pi Makefile' \
		'' \
		'Targets' \
		'  make help                 Show this help (default)' \
		'  make install              Bun pi: setup bun, migrate npm -> bun, copy config,' \
		'                            pi update + pi update --extensions (no Rust build)' \
		'  make install-bun          Same as install, minus the bun-pi restore step' \
		'  make rpi-install          Ensure rust toolchain; build vendor/pi_agent_rust;' \
		'                            install as ~/.local/bin/rpi' \
		'  make rust-toolchain       Install rustup toolchain if cargo missing' \
		'  make rust-install         Build vendor/pi_agent_rust; install as ~/.local/bin/rpi' \
		'  make rust-uninstall       Remove ~/.local/bin/rpi' \
		'  make restore-bun-pi       Give `pi` back to bun after the old vendor-installer takeover' \
		'  make config-install       Copy repo .pi/agent -> ~/.pi/agent only' \
		'  make sync                 Copy live ~/.pi/agent -> repo .pi/agent' \
		'  make setup                Interactive provider/auth bootstrap on a local git branch' \
		'  make test-setup           Build Docker image from filtered tar; run setup cases' \
		'' \
		'Pass-through flags via ARGS=' \
		'  make install ARGS="-h HOST"         set models.json proxy host' \
		'  make config-install ARGS="-h HOST"  same, config copy only' \
		'  make sync ARGS="-p"                 prune repo files missing from live' \
		'  make setup ARGS="--create-branch NAME"' \
		'                                      pin branch name; plain make setup auto-creates pi-install-<ddmmyyyy>' \
		'  make setup ARGS="--help"            setup usage' \
		'  make test-setup ARGS="00-harness"   run one Docker case' \
		'  make rpi-install RPI_DEST=DIR      install rpi into DIR (default ~/.local/bin)' \
		'' \
		'Or call Node directly (same on macOS, Linux, Windows):' \
		'  node scripts/pi.mjs install [--config-only] [-h HOST]' \
		'  node scripts/pi.mjs sync [-p]' \
		'  node scripts/pi.mjs setup --create-branch NAME' \
		'' \
		'Notes' \
		'  `pi` is the bun global TypeScript CLI; `rpi` is the Rust build. Both use ~/.pi/agent.' \
		'  rpi builds with the nightly pinned in vendor/pi_agent_rust/rust-toolchain.toml;' \
		'  rustup auto-installs it on first build.' \
		'  auth.json: api_key merge both ways; oauth home -> repo on sync only.' \
		'  After install, run /reload or /restart inside pi.' \
		'  setup needs a TTY; refuses on main/master/detached unless --create-branch NAME.' \
		'  setup writes repo .pi/agent only; never ~/.pi except via its optional install.' \
		'  test-setup needs Docker; never mounts host repo; secrets excluded by .gitignore.'

install: restore-bun-pi install-bun
	@printf '%s\n' \
		'' \
		'Install complete.' \
		'  pi:  bun TypeScript CLI ($(BUN_BIN)/pi)' \
		'  Run /reload or /restart inside pi.' \
		'  rpi not touched; run make rpi-install to build + install it.'

rpi-install: rust-toolchain rust-install
	@printf '%s\n' \
		'' \
		'rpi install complete.' \
		'  rpi: Rust build of vendor/pi_agent_rust ($(RPI_BIN))'

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

rust-toolchain:
	@if command -v cargo >/dev/null 2>&1; then \
	  echo "cargo present: $$(cargo --version)"; \
	else \
	  command -v rustup >/dev/null 2>&1 || { \
	    command -v brew >/dev/null 2>&1 || { echo 'ERROR: cargo and brew both missing. Install rustup: https://rustup.rs'; exit 1; }; \
	    echo 'Installing rustup via brew...'; \
	    brew install rustup; \
	  }; \
	  echo 'Installing stable toolchain (creates ~/.cargo/bin shims)...'; \
	  rustup toolchain install stable; \
	  rustup default stable; \
	fi
	@command -v cargo >/dev/null 2>&1 || { echo 'ERROR: cargo still missing after rustup setup'; exit 1; }

# cd into the submodule so rustup applies its pinned rust-toolchain.toml;
# --target-dir keeps CARGO_TARGET_DIR / cargo config from moving the artifact.
# Copy then rename: overwriting a running binary in place can get it killed on
# macOS (code-signing cache).
rust-install:
	@test -f $(PI_RUST_DIR)/Cargo.toml || git submodule update --init $(PI_RUST_DIR)
	cd $(PI_RUST_DIR) && cargo build --release --locked --bin pi --target-dir target
	@mkdir -p "$(RPI_DEST)"
	@cp $(PI_RUST_DIR)/target/release/pi "$(RPI_BIN).tmp" && chmod 755 "$(RPI_BIN).tmp" && mv -f "$(RPI_BIN).tmp" "$(RPI_BIN)"
	@echo "Installed $(RPI_BIN): $$("$(RPI_BIN)" --version 2>/dev/null | head -1)"

rust-uninstall:
	rm -f "$(RPI_BIN)"

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
