---
name: android-reverse-engineering
description: Decompile Android APK, XAPK, JAR, and AAR files using jadx or Fernflower/Vineflower. Reverse engineer Android apps, extract HTTP API endpoints (Retrofit, OkHttp, Volley), and trace call flows from UI to network layer. Use when user want to decompile, analyze, or reverse engineer Android packages, find API endpoints, or follow call flows.
user-invocable: true
disable-model-invocation: false
---

# Android Reverse Engineering

Decompile Android APK, XAPK, JAR, and AAR files using jadx and Fernflower/Vineflower, trace call flows through application code and libraries, produce structured documentation of extracted APIs. Two decompiler engines supported — jadx for broad Android coverage, Fernflower for higher-quality output on complex Java code — usable together for comparison.

## Skill location

Scripts and references live under this skill directory. Replace `$SKILL_DIR` with absolute path of this skill folder (typical `~/.pi/agent/skills/android-reverse-engineering` after install, or repo source path before install).

## Prerequisites

Skill require **Java JDK 17+** and **jadx**. **Fernflower/Vineflower** and **dex2jar** optional but recommended for better decompilation quality. Run dependency checker to verify:

```bash
bash $SKILL_DIR/scripts/check-deps.sh
```

On Windows (PowerShell):
```powershell
& "$SKILL_DIR/scripts/check-deps.ps1"
```

Anything missing, follow installation instructions in `$SKILL_DIR/references/setup-guide.md`.

## Workflow

### Phase 0: Fingerprint App (recommended before anything else)

Before install tools or decompile, run fast triage to determine what kind of
app you look at. **Decompile Java mostly useless for Flutter, React Native,
Cordova/Capacitor, and Xamarin apps** — real code live elsewhere. Fingerprint
script tell you which.

```bash
bash $SKILL_DIR/scripts/fingerprint.sh <file.apk|file.xapk>
```

Print in one screen:

- **Mobile framework** (Flutter / React Native / Cordova / Xamarin / Native Kotlin / etc.) with file marker that triggered verdict.
- **HTTP stack** (Retrofit, OkHttp, Ktor, Apollo, Volley) detected via DEX string scan — work even when class names obfuscated.
- **DI / serialization** signals (Hilt, Dagger, Koin, kotlinx.serialization, Moshi, Gson, Jackson).
- **Obfuscation level** estimate based on root-level short-named packages.
- **Notable third-party SDKs** (AppsFlyer, Datadog, Sentry, Firebase, payment SDKs, support/chat SDKs, etc.).
- **Consolidated native libraries** across base APK and all splits — XAPK split bundles often place `.so` files in `config.<abi>.apk`, not in `base.apk`.
- **Recommended next step**, differ by framework (e.g. for Flutter script suggest `blutter` / `strings libapp.so` rather than jadx).

If fingerprint say app is Flutter / RN / Cordova / Xamarin, **stop** and switch
to framework-appropriate tooling. Phases 1–5 below assume native (Java/Kotlin)
Android app.

### Phase 1: Verify and Install Dependencies

Before decompile, confirm required tools available — install any missing.

**Action**: Run dependency check script.

```bash
bash $SKILL_DIR/scripts/check-deps.sh
```

On Windows (PowerShell):
```powershell
& "$SKILL_DIR/scripts/check-deps.ps1"
```

Output contain machine-readable lines:
- `INSTALL_REQUIRED:<dep>` — must install before proceed
- `INSTALL_OPTIONAL:<dep>` — recommended, not blocking

**If required dependencies missing** (exit code 1), install automatic:

```bash
bash $SKILL_DIR/scripts/install-dep.sh <dep>
```

On Windows (PowerShell):
```powershell
& "$SKILL_DIR/scripts/install-dep.ps1" <dep>
```

Install script detect OS and package manager, then:
- Install without sudo when possible (download to `~/.local/share/`, symlink in `~/.local/bin/`)
- Use sudo and system package manager when necessary (apt, dnf, pacman)
- If sudo needed but unavailable or user decline, print exact manual command and exit with code 2 — show these instructions to user

**Windows notes**: PowerShell install script use `winget`, `scoop`, or `choco` (in that order). If none available, download direct to `%USERPROFILE%\.local\share\` and add directory to user PATH. After run `install-dep.ps1`, PATH persisted but current terminal session may not see it. `check-deps.ps1` and `decompile.ps1` scripts auto-refresh PATH from user environment, so re-run find newly installed tools without terminal restart.

**For optional dependencies**, ask user if they want install. Vineflower and dex2jar recommended for best results.

After installation, re-run `check-deps.sh` to confirm all in place. Do not proceed to Phase 2 until all required dependencies OK.

### Phase 2: Decompile

Use decompile wrapper script to process target file. Script support three engines: `jadx`, `fernflower`, `both`.

**Action**: Choose engine, run decompile script. Script handle APK, XAPK, JAR, AAR files.

```bash
bash $SKILL_DIR/scripts/decompile.sh [OPTIONS] <file>
```

On Windows (PowerShell):
```powershell
& "$SKILL_DIR/scripts/decompile.ps1" [OPTIONS] <file>
```

For **XAPK** files (ZIP bundles containing multiple APKs, used by APKPure and similar stores): script auto-extract archive, identify all APK files inside (base + split APKs), decompile each into separate subdirectory. XAPK manifest copied to output for reference.

**Split/bundled APK detection**: Some APKs are bundle wrappers — outer APK hold `base.apk` plus `split_config.*.apk` inside resources dir. jadx then decompile thin wrapper, produce very few Java files. Decompile scripts auto-detect this (≤10 Java files + inner APKs present) and re-decompile `base.apk` into `<output>/base/`. Config-only splits (ABI, language, density) skipped. Main decompiled source live in `<output>/base/sources/`.

Options:
- `-o <dir>` — Custom output directory (default: `<filename>-decompiled`)
- `--deobf` — Enable deobfuscation (recommended for obfuscated apps)
- `--no-res` — Skip resources, decompile code only (faster)
- `--engine ENGINE` — `jadx` (default), `fernflower`, or `both`

**Engine selection strategy**:

| Situation | Engine |
|---|---|
| First pass on any APK | `jadx` (fastest, handles resources) |
| JAR/AAR library analysis | `fernflower` (better Java output) |
| jadx output has warnings/broken code | `both` (compare and pick best per class) |
| Complex lambdas, generics, streams | `fernflower` |
| Quick overview of large APK | `jadx --no-res` |

With `--engine both`, outputs go into `<output>/jadx/` and `<output>/fernflower/`, with comparison summary at end showing file counts and jadx warning counts. Review classes with jadx warnings in Fernflower output for better code.

For APK files with Fernflower, script auto-use dex2jar as intermediate step. dex2jar must be installed.

See `$SKILL_DIR/references/jadx-usage.md` and `$SKILL_DIR/references/fernflower-usage.md` for full CLI references.

### Phase 3: Analyze Structure

Navigate decompiled output to understand app architecture.

**Actions**:

1. **Read AndroidManifest.xml** from `<output>/resources/AndroidManifest.xml`:
   - Identify main launcher Activity
   - List all Activities, Services, BroadcastReceivers, ContentProviders
   - Note permissions (especially `INTERNET`, `ACCESS_NETWORK_STATE`)
   - Find application class (`android:name` on `<application>`)

2. **Survey package structure** under `<output>/sources/`:
   - Identify main app package and sub-packages
   - Distinguish app code from third-party libraries
   - Look for packages named `api`, `network`, `data`, `repository`, `service`, `retrofit`, `http` — API calls live here

3. **Read every `BuildConfig.java`** — almost never obfuscated, frequently leak highest-signal constants in entire APK (base URLs, flavor names, build type, third-party API keys, feature flags):
   ```bash
   find <output>/sources -name BuildConfig.java -exec grep -H '=' {} \;
   ```
   Each Gradle module emit own `BuildConfig`, expect 1–N hits. Read all.

4. **Identify architecture pattern**:
   - MVP: look for `Presenter` classes
   - MVVM: look for `ViewModel` classes and `LiveData`/`StateFlow`
   - Clean Architecture: look for `domain`, `data`, `presentation` packages
   - This inform where to look for network calls in next phases

### Phase 3.5: Recover Kotlin Class Names (only for obfuscated Kotlin apps)

If Phase 0 reported moderate / high obfuscation **and** app is Kotlin
(Compose / kotlin_module markers detected), run metadata recovery script
before trace call flows. R8 obfuscate JVM symbols but cannot strip Kotlin
metadata strings, so original FQNs leak through `@DebugMetadata` and
`@Metadata.d2`.

```bash
bash $SKILL_DIR/scripts/recover-kotlin-names.sh \
    <output>/sources <output>/mapping
```

Then use lookup helper instead of plain grep — every hit come annotated with
owning class real name:

```bash
bash $SKILL_DIR/scripts/lookup-name.sh \
    <output>/mapping --grep '"/api/' <output>/sources
```

Typical recovery on real-world Kotlin app: ~100% of `*Repository` /
`*ViewModel` / `*UseCase` / `*Impl` classes, ~80% of DTOs.

See `$SKILL_DIR/references/kotlin-name-recovery.md`
for full technique and limitations.

### Phase 4: Trace Call Flows

Follow execution paths from user-facing entry points down to network calls.

**Actions**:

1. **Start from entry points**: Read main Activity or Application class identified in Phase 3.

2. **Follow initialization chain**: Application.onCreate() often set up HTTP client, base URL, DI framework. Read this first.

3. **Trace user actions**: From Activity, follow:
   - `onCreate()` > view setup > click listeners
   - Click handler > ViewModel/Presenter method
   - ViewModel > Repository > API service interface
   - API service > actual HTTP call

4. **Map DI bindings** (if Dagger/Hilt used): Find `@Module` classes to understand which implementations provided for which interfaces.

5. **Handle obfuscated code**: When class names mangled, use string literals and library API calls as anchors. Retrofit annotations and URL strings never obfuscated.

See `$SKILL_DIR/references/call-flow-analysis.md` for detailed techniques and grep commands.

### Phase 5: Extract and Document APIs

Find all API endpoints, produce structured documentation.

**Action**: Run API search script for broad sweep.

```bash
bash $SKILL_DIR/scripts/find-api-calls.sh <output>/sources/
```

On Windows (PowerShell):
```powershell
& "$SKILL_DIR/scripts/find-api-calls.ps1" <output>/sources/
```

Targeted searches:
```bash
# Only Retrofit
bash $SKILL_DIR/scripts/find-api-calls.sh <output>/sources/ --retrofit

# Only hardcoded URLs
bash $SKILL_DIR/scripts/find-api-calls.sh <output>/sources/ --urls

# Only auth patterns
bash $SKILL_DIR/scripts/find-api-calls.sh <output>/sources/ --auth
```

On Windows (PowerShell):
```powershell
# Only Retrofit
& "$SKILL_DIR/scripts/find-api-calls.ps1" <output>/sources/ -Retrofit

# Only hardcoded URLs
& "$SKILL_DIR/scripts/find-api-calls.ps1" <output>/sources/ -Urls

# Only auth patterns
& "$SKILL_DIR/scripts/find-api-calls.ps1" <output>/sources/ -Auth
```

Document endpoints in **two tiers** — going deep on every endpoint
prohibitively expensive on apps with 100+ paths, most do not warrant it.
Always produce Tier 1; expand Tier 2 only for endpoints that matter.

#### Tier 1 — flat inventory (always)

Single table covering every discovered endpoint. Aim one line each; cannot
determine column, write `?`.

| Host | Method | Path | Auth | Source file |
|------|--------|------|------|-------------|
| `api.example.com` | GET | `/v1/users/profile` | Bearer | `com/example/api/UserApi.java` |
| `api.example.com` | POST | `/v1/auth/login` | none | `com/example/api/AuthApi.java` |

This table answer "what does backend look like" in one screen, take ~5
minutes to produce from `--paths` output even on large app.

#### Tier 2 — per-endpoint detail (only for high-value endpoints)

Reserve detailed format for few endpoints that need it:

- entire authentication flow (login, refresh, logout, OTP/SMS, anonymous, registration)
- payment / checkout / order-creation endpoints
- anything user explicitly asked about
- anything unusual during scan (custom signing, undocumented headers, etc.)

```markdown
### `METHOD /path`

- **Source**: `com.example.api.ApiService` (ApiService.java:42)
- **Base URL**: `https://api.example.com/v1`
- **Path params**: `id` (String)
- **Query params**: `page` (int), `limit` (int)
- **Headers**: `Authorization: Bearer <token>`
- **Request body**: `{ "email": "string", "password": "string" }`
- **Response**: `ApiResponse<User>`
- **Called from**: `LoginActivity → LoginViewModel → UserRepository → ApiService`
```

Default: do not produce Tier 2 entries for more than ~10 endpoints unless
user explicitly ask — Tier 1 plus Tier 2 deep dive on authentication + 1-2 key
flows is what most consumers of this work want.

See `$SKILL_DIR/references/api-extraction-patterns.md` for library-specific search patterns and full documentation template.

## Output

At end of workflow, deliver:

1. **Decompiled source** in output directory
2. **Architecture summary** — app structure, main packages, pattern used
3. **API documentation** — all discovered endpoints in format above
4. **Call flow map** — key paths from UI to network (especially authentication and main features)

## References

- `$SKILL_DIR/references/setup-guide.md` — Installing Java, jadx, Fernflower/Vineflower, dex2jar, and optional tools
- `$SKILL_DIR/references/jadx-usage.md` — jadx CLI options and workflows
- `$SKILL_DIR/references/fernflower-usage.md` — Fernflower/Vineflower CLI options, when to use, APK workflow
- `$SKILL_DIR/references/api-extraction-patterns.md` — Library-specific search patterns and documentation template
- `$SKILL_DIR/references/call-flow-analysis.md` — Techniques for tracing call flows in decompiled code
