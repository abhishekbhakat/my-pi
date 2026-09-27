# my-pi — install / sync live ~/.pi config + Rust pi CLI
#
#   make help
#   make install                       (rustup + rust pi build/install + config copy)
#   make install ARGS="--force"        (pass-through to vendor install.sh)
#   make rust-toolchain                (ensure cargo via rustup)
#   make rust-install                  (build + install rust pi only)
#   make config-install                (repo .pi/agent -> ~/.pi/agent only)
#   make rust-uninstall                (remove rust pi via vendor uninstall.sh)
#   make install-bun                   (legacy bun CLI flow, rollback path)
#   make sync                          (live ~/.pi/agent -> repo .pi/agent)
#   make sync ARGS="-p"                (also prune repo files missing from live)
#   make setup                         (auto-branch pi-install-<ddmmyyyy> on main)
#   make test-setup                    (Docker setup cases)

SHELL := /bin/sh
.DEFAULT_GOAL := help

CLI := node scripts/pi.mjs

PI_RUST_DIR := vendor/pi_agent_rust
PI_INSTALLER := $(PI_RUST_DIR)/install.sh
PI_PKG := @earendil-works/pi-coding-agent

# rustup shims: ~/.cargo/bin (rustup.rs install) and/or brew keg path (brew rustup
# keeps cargo/rustc proxies in its opt dir, unlinked from /opt/homebrew/bin).
RUSTUP_BIN := $(shell brew --prefix rustup 2>/dev/null)/bin
export PATH := $(HOME)/.cargo/bin:$(RUSTUP_BIN):$(PATH)

.PHONY: help install rust-toolchain rust-install config-install rust-uninstall install-bun sync setup test-setup

help:
	@printf '%s\n' \
		'my-pi Makefile' \
		'' \
		'Targets' \
		'  make help                 Show this help (default)' \
		'  make install              Ensure rustup; build + install rust pi from' \
		'                            vendor/pi_agent_rust; TS pi kept as legacy-pi; copy config' \
		'  make rust-toolchain       Install rustup toolchain if cargo missing' \
		'  make rust-install         Build + install rust pi only (vendor install.sh)' \
		'  make config-install       Copy repo .pi/agent -> ~/.pi/agent only' \
		'  make rust-uninstall       Remove rust pi via vendor uninstall.sh' \
		'  make install-bun          Legacy flow: bun pi CLI + config copy' \
		'  make sync                 Copy live ~/.pi/agent -> repo .pi/agent' \
		'  make setup                Interactive provider/auth bootstrap on a local git branch' \
		'  make test-setup           Build Docker image from filtered tar; run setup cases' \
		'' \
		'Pass-through flags via ARGS=' \
		'  make install ARGS="--force"         forwarded to vendor install.sh' \
		'  make install ARGS="--dest DIR"      install rust pi to DIR (default ~/.local/bin)' \
		'  make config-install ARGS="-h HOST"  set models.json proxy host' \
		'  make sync ARGS="-p"                 prune repo files missing from live' \
		'  make setup ARGS="--create-branch NAME"' \
		'                                      pin branch name; plain make setup auto-creates pi-install-<ddmmyyyy>' \
		'  make setup ARGS="--help"            setup usage' \
		'  make test-setup ARGS="00-harness"   run one Docker case' \
		'' \
		'Or call Node directly (same on macOS, Linux, Windows):' \
		'  node scripts/pi.mjs install [--config-only] [-h HOST]' \
		'  node scripts/pi.mjs sync [-p]' \
		'  node scripts/pi.mjs setup --create-branch NAME' \
		'' \
		'Notes' \
		'  Rust pi becomes the canonical `pi`; the vendor installer adopts the' \
		'  existing pi path when migrating (default dest ~/.local/bin).' \
		'  TS bun pi is preserved by migration under the legacy-pi alias.' \
		'  Toolchain pin lives in vendor/pi_agent_rust/rust-toolchain.toml (nightly);' \
		'  rustup auto-installs the pinned nightly on first build.' \
		'  auth.json: api_key merge both ways; oauth home -> repo on sync only.' \
		'  After install, run /reload or /restart inside pi.' \
		'  setup needs a TTY; refuses on main/master/detached unless --create-branch NAME.' \
		'  setup writes repo .pi/agent only; never ~/.pi except via its optional install.' \
		'  test-setup needs Docker; never mounts host repo; secrets excluded by .gitignore.'

install: rust-toolchain rust-install config-install
	@printf '%s\n' \
		'' \
		'Install complete.' \
		'  Rust pi is now the canonical `pi` (see install summary above for path).' \
		'  Legacy TS: legacy-pi alias (bun copy preserved).' \
		'  Run /reload or /restart inside pi.'

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

rust-install:
	@test -f $(PI_INSTALLER) || git submodule update --init $(PI_RUST_DIR)
	@if command -v npm >/dev/null 2>&1; then \
	  npm uninstall -g $(PI_PKG) >/dev/null 2>&1 && echo 'Removed npm global pi (if present)'; \
	fi
	bash $(PI_INSTALLER) --source-dir $(PI_RUST_DIR) --adopt --yes --verify --no-agent-skills $(ARGS)

config-install:
	$(CLI) install --config-only $(ARGS)

rust-uninstall:
	@test -f $(PI_RUST_DIR)/uninstall.sh || { echo 'ERROR: $(PI_RUST_DIR)/uninstall.sh missing'; exit 1; }
	bash $(PI_RUST_DIR)/uninstall.sh $(ARGS)

install-bun:
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
