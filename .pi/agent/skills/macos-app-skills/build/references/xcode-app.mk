# Xcode macOS .app Makefile (no SPM, no Sparkle nested-sign).
# Copy to repo root as Makefile. Fill the variables.
# Daily loop: make run. Ship loop: make install (notarize, ~1 min).

PROJECT_NAME   = MyApp
BUNDLE_ID      = com.example.myapp
PROJECT        = $(PROJECT_NAME).xcodeproj
SCHEME         = $(PROJECT_NAME)
TEAM_ID       ?= YOUR_TEAM_ID
SIGN_IDENTITY  = Developer ID Application
NOTARY_PROFILE = AC_PASSWORD

# Full icns from iconutil (see cli-ship.md). Leave empty to skip overwrite.
ICON_ICNS     ?=

BUILD_DIR  = build
DIST_DIR   = $(BUILD_DIR)/dist
APP_BUNDLE = $(BUILD_DIR)/Build/Products/Release/$(PROJECT_NAME).app
DEST       = platform=macOS
export DEVELOPER_DIR ?= /Applications/Xcode.app/Contents/Developer

HOST_ARCH := $(shell uname -m)
ARCH      ?= $(HOST_ARCH)

ifeq ($(ARCH),universal)
ARCHS_VALUE = arm64 x86_64
ONLY_ACTIVE = NO
ARCH_TAG    = universal
else
ARCHS_VALUE = $(ARCH)
ONLY_ACTIVE = YES
ARCH_TAG    = $(ARCH)
endif

VERSION   = $(shell /usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "$(APP_BUNDLE)/Contents/Info.plist" 2>/dev/null || echo "1.0")
DIST_NAME = $(PROJECT_NAME)-$(VERSION)-macOS-$(ARCH_TAG)

.PHONY: all build run release release-arm64 release-x86_64 release-universal \
	clean test list sign zip notarize dmg dist install uninstall help

all: build

list:
	xcodebuild -list -project $(PROJECT)

build:
	xcodebuild build \
	  -project $(PROJECT) \
	  -scheme $(SCHEME) \
	  -configuration Debug \
	  -destination "$(DEST)" \
	  -derivedDataPath $(BUILD_DIR) \
	  ARCHS="$(HOST_ARCH)" \
	  ONLY_ACTIVE_ARCH=YES

define EMBED_ICON
	@if [ -n "$(ICON_ICNS)" ] && [ -f "$(ICON_ICNS)" ]; then \
		cp "$(ICON_ICNS)" "$(1)/Contents/Resources/AppIcon.icns"; \
	fi
endef

run: build
	$(call EMBED_ICON,$(BUILD_DIR)/Build/Products/Debug/$(PROJECT_NAME).app)
	open "$(BUILD_DIR)/Build/Products/Debug/$(PROJECT_NAME).app"

release:
	xcodebuild build \
	  -project $(PROJECT) \
	  -scheme $(SCHEME) \
	  -configuration Release \
	  -destination "$(DEST)" \
	  -derivedDataPath $(BUILD_DIR) \
	  ARCHS="$(ARCHS_VALUE)" \
	  ONLY_ACTIVE_ARCH=$(ONLY_ACTIVE) \
	  DEVELOPMENT_TEAM="$(TEAM_ID)" \
	  CODE_SIGN_IDENTITY="$(SIGN_IDENTITY)" \
	  CODE_SIGN_STYLE=Manual

release-arm64:
	$(MAKE) release ARCH=arm64

release-x86_64:
	$(MAKE) release ARCH=x86_64

release-universal:
	$(MAKE) release ARCH=universal

test:
	xcodebuild test \
	  -project $(PROJECT) \
	  -scheme $(SCHEME) \
	  -destination "$(DEST)" \
	  -derivedDataPath $(BUILD_DIR) \
	  ARCHS="$(HOST_ARCH)" \
	  ONLY_ACTIVE_ARCH=YES

define SIGN_APP
	$(call EMBED_ICON,$(1))
	codesign --force --timestamp --sign "$(SIGN_IDENTITY)" \
		--identifier "$(BUNDLE_ID)" \
		--options runtime \
		"$(1)"
endef

sign: release
	$(call SIGN_APP,$(APP_BUNDLE))

define CREATE_ZIP
	@mkdir -p $(DIST_DIR)
	ditto -c -k --keepParent "$(1)" "$(DIST_DIR)/$(2).zip"
endef

zip: sign
	$(call CREATE_ZIP,$(APP_BUNDLE),$(DIST_NAME))

define NOTARIZE_ZIP
	xcrun notarytool submit "$(1)" --keychain-profile "$(NOTARY_PROFILE)" --wait
endef

define STAPLE_APP
	xcrun stapler staple "$(1)"
endef

notarize: zip
	$(call NOTARIZE_ZIP,$(DIST_DIR)/$(DIST_NAME).zip)
	$(call STAPLE_APP,$(APP_BUNDLE))
	@rm -f "$(DIST_DIR)/$(DIST_NAME).zip"
	$(call CREATE_ZIP,$(APP_BUNDLE),$(DIST_NAME))

define CREATE_DMG
	@mkdir -p $(DIST_DIR)
	@rm -f "$(DIST_DIR)/$(2).dmg"
	@if command -v create-dmg >/dev/null 2>&1; then \
		create-dmg --volname "$(PROJECT_NAME) $(VERSION)" \
			--window-pos 200 120 --window-size 600 400 --icon-size 100 \
			--app-drop-link 450 185 --icon "$(PROJECT_NAME).app" 150 185 \
			"$(DIST_DIR)/$(2).dmg" "$(1)"; \
	else \
		hdiutil create -srcfolder "$(1)" -volname "$(PROJECT_NAME)" -fs HFS+ \
			-format UDZO -o "$(DIST_DIR)/$(2).dmg"; \
	fi
endef

dmg: notarize
	$(call CREATE_DMG,$(APP_BUNDLE),$(DIST_NAME))

dist: dmg

install: notarize
	@pkill -x "$(PROJECT_NAME)" >/dev/null 2>&1 || true
	@rm -rf "/Applications/$(PROJECT_NAME).app"
	ditto "$(APP_BUNDLE)" "/Applications/$(PROJECT_NAME).app"
	codesign --verify --deep --strict "/Applications/$(PROJECT_NAME).app"

uninstall:
	rm -rf "/Applications/$(PROJECT_NAME).app"

clean:
	xcodebuild clean -project $(PROJECT) -scheme $(SCHEME)
	rm -rf $(BUILD_DIR)

help:
	@echo "make build | run | release | release-arm64 | release-x86_64 | release-universal"
	@echo "make sign | zip | notarize | dmg | dist | install | test | clean"
	@echo "Default release is host arch ($(HOST_ARCH)). Override: make release ARCH=x86_64"
