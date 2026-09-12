# SPM macOS .app Makefile (no Xcode project).
# Copy to repo root as Makefile. Fill the variables.

PROJECT_NAME     = MyApp
BUNDLE_ID        = com.example.myapp
TEAM_ID         ?= YOUR_TEAM_ID
SIGN_IDENTITY    = Developer ID Application
NOTARY_PROFILE   = AC_PASSWORD
ENTITLEMENTS     = $(PROJECT_NAME).entitlements
INFO_PLIST       = Info.plist
MACOSX_DEPLOYMENT_TARGET = 14.0
RESOURCES_DIR    = Sources/$(PROJECT_NAME)/Resources
APP_ICON         = assets/AppIcon.icns

SPARKLE_DIR = .build/artifacts/sparkle/Sparkle
SPARKLE_FRAMEWORK = $(SPARKLE_DIR)/Sparkle.xcframework/macos-arm64_x86_64/Sparkle.framework
SIGN_UPDATE = $(SPARKLE_DIR)/bin/sign_update

BUILD_DIR = build
DIST_DIR  = $(BUILD_DIR)/dist
APP_BUNDLE = $(BUILD_DIR)/$(PROJECT_NAME).app
APP_BUNDLE_ARM64 = $(BUILD_DIR)/arm64/$(PROJECT_NAME).app
APP_BUNDLE_X64   = $(BUILD_DIR)/x64/$(PROJECT_NAME).app

RELEASE_BIN       = .build/release/$(PROJECT_NAME)
DEBUG_BIN         = .build/debug/$(PROJECT_NAME)
BUILD_DIR_ARM64   = .build/release-arm64
BUILD_DIR_X64     = .build/x86_64-apple-macosx/release
RELEASE_BIN_ARM64 = $(BUILD_DIR_ARM64)/$(PROJECT_NAME)
RELEASE_BIN_X64   = $(BUILD_DIR_X64)/$(PROJECT_NAME)

VERSION = $(shell /usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" $(INFO_PLIST) 2>/dev/null || echo "0.1.0")
DIST_NAME_ARM64     = $(PROJECT_NAME)-$(VERSION)-macOS-arm64
DIST_NAME_X64       = $(PROJECT_NAME)-$(VERSION)-macOS-x64
DIST_NAME_UNIVERSAL = $(PROJECT_NAME)-$(VERSION)-macOS-universal

.PHONY: all build run release clean fmt \
	release-arm64 release-x64 release-universal \
	bundle bundle-raw bundle-raw-arm64 bundle-raw-x64 bundle-raw-universal \
	sign-arm64 sign-x64 sign-universal \
	zip-arm64 zip-x64 zip-universal \
	notarize-arm64 notarize-x64 notarize-universal \
	dmg dmg-arm64 dmg-x64 dmg-universal \
	dist dist-arm64 dist-x64 dist-universal sparkle-sign install help

all: build

build:
	swift build

run: build
	$(DEBUG_BIN)

release:
	swift build -c release

clean:
	swift package clean
	rm -rf $(BUILD_DIR) .build/release-*

fmt:
	@if command -v swiftformat >/dev/null 2>&1; then swiftformat Sources/; \
	elif command -v swift-format >/dev/null 2>&1; then swift-format --in-place --recursive Sources/; \
	else echo "Neither swiftformat nor swift-format found."; exit 1; fi

release-arm64:
	swift build -c release --arch arm64
	@mkdir -p $(BUILD_DIR_ARM64)
	@cp .build/release/$(PROJECT_NAME) $(RELEASE_BIN_ARM64)

release-x64:
	swift build -c release --arch x86_64
	@mkdir -p $(BUILD_DIR_X64)
	@cp .build/x86_64-apple-macosx/release/$(PROJECT_NAME) $(RELEASE_BIN_X64)

release-universal: release-arm64 release-x64
	@mkdir -p .build/release-universal
	lipo -create $(RELEASE_BIN_ARM64) $(RELEASE_BIN_X64) \
		-output .build/release-universal/$(PROJECT_NAME)
	@cp .build/release-universal/$(PROJECT_NAME) $(RELEASE_BIN)

define BUNDLE_APP
	@rm -rf "$(1)"
	@mkdir -p "$(1)/Contents/MacOS" "$(1)/Contents/Resources" "$(1)/Contents/Frameworks"
	@cp $(2) "$(1)/Contents/MacOS/$(PROJECT_NAME)"
	@cp $(INFO_PLIST) "$(1)/Contents/Info.plist"
	@if [ -f "$(APP_ICON)" ]; then cp "$(APP_ICON)" "$(1)/Contents/Resources/AppIcon.icns"; fi
	@if [ -d "$(RESOURCES_DIR)" ]; then rsync -a "$(RESOURCES_DIR)/" "$(1)/Contents/Resources/"; fi
	@if [ -d "$(SPARKLE_FRAMEWORK)" ]; then ditto "$(SPARKLE_FRAMEWORK)" "$(1)/Contents/Frameworks/Sparkle.framework"; fi
	@sed -i '' 's/$$(EXECUTABLE_NAME)/$(PROJECT_NAME)/g' "$(1)/Contents/Info.plist"
	@sed -i '' 's/$$(PRODUCT_BUNDLE_IDENTIFIER)/$(BUNDLE_ID)/g' "$(1)/Contents/Info.plist"
	@sed -i '' 's/$$(PRODUCT_NAME)/$(PROJECT_NAME)/g' "$(1)/Contents/Info.plist"
	@sed -i '' 's/$$(MACOSX_DEPLOYMENT_TARGET)/$(MACOSX_DEPLOYMENT_TARGET)/g' "$(1)/Contents/Info.plist"
endef

bundle-raw-arm64: release-arm64
	$(call BUNDLE_APP,$(APP_BUNDLE_ARM64),$(RELEASE_BIN_ARM64))

bundle-raw-x64: release-x64
	$(call BUNDLE_APP,$(APP_BUNDLE_X64),$(RELEASE_BIN_X64))

bundle-raw-universal: release-universal
	$(call BUNDLE_APP,$(APP_BUNDLE),.build/release-universal/$(PROJECT_NAME))

bundle-raw: bundle-raw-universal

# Sparkle nested binaries first, then the app (hardened runtime + entitlements).
define SIGN_SPARKLE
	codesign --force --timestamp --sign "$(SIGN_IDENTITY)" --options runtime \
		--preserve-metadata=entitlements \
		"$(1)/Contents/Frameworks/Sparkle.framework/Versions/B/XPCServices/Downloader.xpc"
	codesign --force --timestamp --sign "$(SIGN_IDENTITY)" --options runtime \
		--preserve-metadata=entitlements \
		"$(1)/Contents/Frameworks/Sparkle.framework/Versions/B/XPCServices/Installer.xpc"
	codesign --force --timestamp --sign "$(SIGN_IDENTITY)" --options runtime \
		--preserve-metadata=entitlements \
		"$(1)/Contents/Frameworks/Sparkle.framework/Versions/B/Autoupdate"
	codesign --force --timestamp --sign "$(SIGN_IDENTITY)" --options runtime \
		--preserve-metadata=entitlements \
		"$(1)/Contents/Frameworks/Sparkle.framework/Versions/B/Updater.app"
	codesign --force --timestamp --sign "$(SIGN_IDENTITY)" --options runtime \
		--preserve-metadata=entitlements \
		"$(1)/Contents/Frameworks/Sparkle.framework"
endef

define SIGN_APP
	$(call SIGN_SPARKLE,$(1))
	codesign --force --timestamp --sign "$(SIGN_IDENTITY)" \
		--identifier "$(BUNDLE_ID)" \
		--options runtime \
		--entitlements $(ENTITLEMENTS) \
		"$(1)"
endef

sign-arm64: bundle-raw-arm64
	$(call SIGN_APP,$(APP_BUNDLE_ARM64))

sign-x64: bundle-raw-x64
	$(call SIGN_APP,$(APP_BUNDLE_X64))

sign-universal: bundle-raw-universal
	$(call SIGN_APP,$(APP_BUNDLE))

define CREATE_ZIP
	@mkdir -p $(DIST_DIR)
	ditto -c -k --keepParent "$(1)" "$(DIST_DIR)/$(2).zip"
endef

zip-arm64: sign-arm64
	$(call CREATE_ZIP,$(APP_BUNDLE_ARM64),$(DIST_NAME_ARM64))

zip-x64: sign-x64
	$(call CREATE_ZIP,$(APP_BUNDLE_X64),$(DIST_NAME_X64))

zip-universal: sign-universal
	$(call CREATE_ZIP,$(APP_BUNDLE),$(DIST_NAME_UNIVERSAL))

define NOTARIZE_ZIP
	xcrun notarytool submit "$(1)" --keychain-profile "$(NOTARY_PROFILE)" --wait
endef

define STAPLE_APP
	xcrun stapler staple "$(1)"
endef

notarize-arm64: zip-arm64
	$(call NOTARIZE_ZIP,$(DIST_DIR)/$(DIST_NAME_ARM64).zip)
	$(call STAPLE_APP,$(APP_BUNDLE_ARM64))
	@rm "$(DIST_DIR)/$(DIST_NAME_ARM64).zip"
	$(call CREATE_ZIP,$(APP_BUNDLE_ARM64),$(DIST_NAME_ARM64))

notarize-x64: zip-x64
	$(call NOTARIZE_ZIP,$(DIST_DIR)/$(DIST_NAME_X64).zip)
	$(call STAPLE_APP,$(APP_BUNDLE_X64))
	@rm "$(DIST_DIR)/$(DIST_NAME_X64).zip"
	$(call CREATE_ZIP,$(APP_BUNDLE_X64),$(DIST_NAME_X64))

notarize-universal: zip-universal
	$(call NOTARIZE_ZIP,$(DIST_DIR)/$(DIST_NAME_UNIVERSAL).zip)
	$(call STAPLE_APP,$(APP_BUNDLE))
	@rm "$(DIST_DIR)/$(DIST_NAME_UNIVERSAL).zip"
	$(call CREATE_ZIP,$(APP_BUNDLE),$(DIST_NAME_UNIVERSAL))

bundle-arm64: notarize-arm64
bundle-x64: notarize-x64
bundle-universal: notarize-universal
bundle: bundle-universal

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

dmg-arm64: bundle-arm64
	$(call CREATE_DMG,$(APP_BUNDLE_ARM64),$(DIST_NAME_ARM64))

dmg-x64: bundle-x64
	$(call CREATE_DMG,$(APP_BUNDLE_X64),$(DIST_NAME_X64))

dmg-universal: bundle-universal
	$(call CREATE_DMG,$(APP_BUNDLE),$(DIST_NAME_UNIVERSAL))

dmg: dmg-universal

dist-arm64: dmg-arm64
dist-x64: dmg-x64
dist-universal: dmg-universal
dist: dist-arm64 dist-x64 dist-universal

sparkle-sign:
	@test -f "$(DIST_DIR)/$(DIST_NAME_UNIVERSAL).dmg" || { echo "run make dist first"; exit 1; }
	"$(SIGN_UPDATE)" "$(DIST_DIR)/$(DIST_NAME_UNIVERSAL).dmg"

install: dist-universal
	@pkill -x "$(PROJECT_NAME)" >/dev/null 2>&1 || true
	@rm -rf "/Applications/$(PROJECT_NAME).app"
	ditto "$(APP_BUNDLE)" "/Applications/$(PROJECT_NAME).app"
	codesign --verify --deep --strict "/Applications/$(PROJECT_NAME).app"

help:
	@echo "make build | run | release | release-universal | bundle-raw | dist | install | sparkle-sign"
