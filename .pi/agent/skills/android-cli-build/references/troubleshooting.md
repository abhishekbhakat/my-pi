# Android CLI troubleshooting

## SDK location not found

```text
SDK location not found. Define a valid SDK location with an ANDROID_HOME
environment variable or by setting the sdk.dir path in your project's
local.properties file.
```

Fix:

```bash
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
echo "sdk.dir=$ANDROID_HOME" > local.properties
```

## Wrong Java version

AGP 8.7 + Kotlin 2.0 expect **JDK 17** for most setups. Homebrew `openjdk` (e.g. 26) can break the Android Gradle Plugin.

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@17
export PATH="$JAVA_HOME/bin:$PATH"
java -version   # should show 17.x
```

## sdkmanager not found

```bash
brew install --cask android-commandlinetools
which sdkmanager
```

## Missing platform / build-tools

```bash
sdkmanager --sdk_root="$ANDROID_HOME" --list_installed
sdkmanager --sdk_root="$ANDROID_HOME" "platforms;android-35" "build-tools;35.0.0"
```

## Licenses

```bash
yes | sdkmanager --sdk_root="$ANDROID_HOME" --licenses
```

## adb: no devices / unauthorized

```bash
adb kill-server
adb start-server
adb devices -l
```

On device: enable Developer options → USB debugging; accept the RSA dialog.

## install failed: version downgrade

```bash
adb install -r app-debug.apk
# or uninstall first
adb uninstall com.example.app
```

## Compose Modifier unresolved

Use:

```kotlin
import androidx.compose.ui.Modifier
```

Not `androidx.compose.ui.modifier.modifier`.

## Health Connect not available

Install/update **Health Connect** from Play Store (`com.google.android.apps.healthdata`). Check:

```kotlin
HealthConnectClient.getSdkStatus(context)
```

## Case-insensitive gitignore swallowing Kotlin `data/`

```gitignore
# bad
DATA/

# good
/DATA/
```

```bash
git check-ignore -v path/to/.../data/Foo.kt
```

## Full compile log

When filtered output is empty:

```bash
./gradlew :app:compileDebugKotlin --stacktrace
./gradlew :app:assembleDebug --info 2>&1 | tail -100
```
