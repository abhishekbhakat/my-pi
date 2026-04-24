:; if command -v cygpath >/dev/null 2>&1; then exec cmd.exe /c "$(cygpath -w "$0")" "$@"; elif command -v wslpath >/dev/null 2>&1; then exec cmd.exe /c "$(wslpath -w "$0")" "$@"; else exec cmd.exe /c "$0" "$@"; fi # 2>/dev/null
@echo off
setlocal

set "ASSUME_YES=0"
set "PROXY_HOST=localhost"
set "PROXY_HOST_PROVIDED=0"

:ParseArgs
if "%~1"=="" goto :ArgsDone
if /i "%~1"=="-y" (
    set "ASSUME_YES=1"
    shift
    goto :ParseArgs
)
if /i "%~1"=="-h" (
    if "%~2"=="" (
        echo ERROR: Option -h requires an argument.
        call :Usage
        exit /b 1
    )
    set "PROXY_HOST=%~2"
    set "PROXY_HOST_PROVIDED=1"
    shift
    shift
    goto :ParseArgs
)
echo ERROR: Unknown option %~1
call :Usage
exit /b 1

:ArgsDone
if "%PROXY_HOST%"=="" (
    echo ERROR: -h requires a non-empty host.
    exit /b 1
)

set "TEST_HOST=%PROXY_HOST%"
set "TEST_HOST=%TEST_HOST: =%"
set "TEST_HOST=%TEST_HOST:!=%"
set "TEST_HOST=%TEST_HOST:&=%"
set "TEST_HOST=%TEST_HOST:|=%"
set "TEST_HOST=%TEST_HOST:<=%"
set "TEST_HOST=%TEST_HOST:>=%"
set "TEST_HOST=%TEST_HOST:^=%"
set "TEST_HOST=%TEST_HOST:"=%"
set "TEST_HOST=%TEST_HOST:%%=%"
if not "%TEST_HOST%"=="%PROXY_HOST%" (
    echo ERROR: Proxy host contains invalid characters ^(spaces, quotes, ampersands, pipes, etc.^).
    exit /b 1
)

set "PROXY_ORIGIN=%PROXY_HOST%"
:TrimOriginSlash
if "%PROXY_ORIGIN:~-1%"=="/" (
    set "PROXY_ORIGIN=%PROXY_ORIGIN:~0,-1%"
    goto :TrimOriginSlash
)
if /i "%PROXY_ORIGIN:~-3%"=="/v1" set "PROXY_ORIGIN=%PROXY_ORIGIN:~0,-3%"
:TrimOriginSlashAfterV1
if "%PROXY_ORIGIN:~-1%"=="/" (
    set "PROXY_ORIGIN=%PROXY_ORIGIN:~0,-1%"
    goto :TrimOriginSlashAfterV1
)
if "%PROXY_ORIGIN%"=="" (
    echo ERROR: -h requires a non-empty host.
    exit /b 1
)
if /i "%PROXY_ORIGIN:~0,7%"=="http://" goto :OriginReady
if /i "%PROXY_ORIGIN:~0,8%"=="https://" goto :OriginReady
if not "%PROXY_ORIGIN::=%"=="%PROXY_ORIGIN%" (
    set "PROXY_ORIGIN=http://%PROXY_ORIGIN%"
) else (
    set "PROXY_ORIGIN=http://%PROXY_ORIGIN%:8383"
)
:OriginReady

setlocal enabledelayedexpansion

:: install.bat - Copy .pi config from repo to ~/.pi
:: If invoked from a POSIX-like shell (Git Bash/WSL/MSYS), the first line
:: re-execs this script via cmd.exe so shell redirections do not create a
:: literal "nul" file in the working directory.
:: Replaces each target subtree before copying, so stale files do not linger.

set "SOURCE=%~dp0.pi\agent"
set "TARGET=%USERPROFILE%\.pi\agent"

if not exist "%SOURCE%" (
    echo ERROR: Source directory not found: %SOURCE%
    exit /b 1
)

echo Copying .pi\agent -^> %TARGET%
echo.

:: Files to never overwrite (user-specific config that may differ from repo)
set "PROTECTED_FILES=settings.json models.json damage-control-rules.yaml SYSTEM.md PREREQS.md"

:: Ask about protected files unless -y was provided.
set "OVERWRITE_PROTECTED="
if "%ASSUME_YES%"=="1" (
    set "OVERWRITE_PROTECTED=y"
    echo   -y provided; will overwrite protected files.
) else (
    set /p "OVERWRITE_PROTECTED=Overwrite protected config files (settings.json, models.json, etc.)? [y/N]: "
    if /i "!OVERWRITE_PROTECTED!"=="y" (
        echo   Will overwrite protected files.
    ) else (
        echo   Will skip protected files.
    )
)
if "%PROXY_HOST_PROVIDED%"=="1" (
    echo   Will set models.json proxy origin to !PROXY_ORIGIN!.
)
echo.

:: Create target base directory
if not exist "%TARGET%" mkdir "%TARGET%"

:: Counters
set /a COPIED=0
set /a SKIPPED=0

:: --- Copy extensions, skills, themes, and root-level files ---
:: Each subtree is removed first, then copied into a fresh target directory.

:: Extensions
echo [extensions]
call :CopyDir "%SOURCE%\extensions" "%TARGET%\extensions"
echo.

:: npm install in extensions directory
echo [extensions npm]
if exist "%TARGET%\extensions\package.json" (
    where npm > nul 2>&1
    if errorlevel 1 (
        echo   npm not found; skipping npm install.
    ) else (
        pushd "%TARGET%\extensions"
        call npm install > nul 2>&1
        if errorlevel 1 (
            echo   WARNING: npm install failed.
        ) else (
            echo   npm install complete.
        )
        popd
    )
)
echo.

:: Skills
echo [skills]
call :CopyDir "%SOURCE%\skills" "%TARGET%\skills"
echo.

:: Themes
echo [themes]
call :CopyDir "%SOURCE%\themes" "%TARGET%\themes"
echo.

:: Root-level files (settings, models, rules, etc.)
echo [root files]
call :CopyRootFiles
echo.
call :PatchModelsJson || exit /b 1

:: --- Copy agents directory (sibling of agent/) ---
set "AGENTS_SRC=%~dp0.pi\agents"
set "AGENTS_DST=%USERPROFILE%\.pi\agents"
if exist "%AGENTS_SRC%" (
    echo [agents]
    if exist "%AGENTS_DST%" rmdir /s /q "%AGENTS_DST%" >nul 2>&1
    mkdir "%AGENTS_DST%" >nul 2>&1
    if exist "%AGENTS_SRC%\*.md" (
        copy /y "%AGENTS_SRC%\*.md" "%AGENTS_DST%\" >nul 2>&1
    )
    echo   Done.
    echo.
)

echo.
echo =============================
echo  Copy complete.
echo  Copied: !COPIED!
echo  Skipped: !SKIPPED!
echo =============================
echo.
echo Run /reload in pi to pick up changes.
goto :eof

:: -------------------------------------------------------
:: CopyDir - replace a subtree, then copy source contents into it
:: Args: %1=source %2=target
:: -------------------------------------------------------
:CopyDir
set "SD_SRC=%~1"
set "SD_DST=%~2"
if not exist "%SD_SRC%" goto :eof
if exist "%SD_DST%" rmdir /s /q "%SD_DST%" >nul 2>&1
mkdir "%SD_DST%" >nul 2>&1

robocopy "%SD_SRC%" "%SD_DST%" /E /njh /njs /ndl /nc /ns /np >nul 2>&1
if errorlevel 8 (
    echo   WARNING: robocopy failed.
) else (
    for /r "%SD_DST%" %%F in (package-lock.json) do del /q "%%F" >nul 2>&1
    echo   Files copied.
    set /a COPIED+=1
)
goto :eof

:: -------------------------------------------------------
:: CopyRootFiles - copy individual root-level config files
:: -------------------------------------------------------
:CopyRootFiles
for %%F in (settings.json models.json damage-control-rules.yaml SYSTEM.md PREREQS.md) do (
    if exist "%SOURCE%\%%F" (
        set "IS_PROTECTED=0"
        for %%P in (%PROTECTED_FILES%) do (
            if /i "%%F"=="%%P" set "IS_PROTECTED=1"
        )
        if "!IS_PROTECTED!"=="1" if /i not "!OVERWRITE_PROTECTED!"=="y" (
            echo   Skipping %%F ^(protected^)
            set /a SKIPPED+=1
        ) else (
            copy /y "%SOURCE%\%%F" "%TARGET%\%%F" >nul 2>&1
            echo   Copied %%F
            set /a COPIED+=1
        )
    )
)
goto :eof

:: -------------------------------------------------------
:: PatchModelsJson - update target models.json proxy host
:: -------------------------------------------------------
:PatchModelsJson
if not "%PROXY_HOST_PROVIDED%"=="1" exit /b 0
set "MODELS_FILE=%TARGET%\models.json"
echo [models proxy]
if not exist "%MODELS_FILE%" (
    echo   Skipping proxy update; models.json not found.
    echo.
    exit /b 0
)

set "PS_SCRIPT=%TEMP%\pi-install-models-%RANDOM%-%RANDOM%.ps1"
set "PI_MODELS_FILE=%MODELS_FILE%"
set "PI_PROXY_ORIGIN=%PROXY_ORIGIN%"
> "%PS_SCRIPT%" echo $path = $env:PI_MODELS_FILE
>> "%PS_SCRIPT%" echo $origin = $env:PI_PROXY_ORIGIN
>> "%PS_SCRIPT%" echo $quote = [char]34
>> "%PS_SCRIPT%" echo $pattern = '(' + $quote + 'baseUrl' + $quote + '\s*:\s*' + $quote + ').*?(' + $quote + ')'
>> "%PS_SCRIPT%" echo $text = [IO.File]::ReadAllText($path)
>> "%PS_SCRIPT%" echo $replacement = {
>> "%PS_SCRIPT%" echo     param($m)
>> "%PS_SCRIPT%" echo     $suffix = if ($m.Value.EndsWith('/v1' + [char]34)) { '/v1' } else { '' }
>> "%PS_SCRIPT%" echo     $m.Groups[1].Value + $origin + $suffix + $m.Groups[2].Value
>> "%PS_SCRIPT%" echo }
>> "%PS_SCRIPT%" echo $text = [regex]::Replace($text, $pattern, $replacement)
>> "%PS_SCRIPT%" echo [IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding $false))

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" >nul
if errorlevel 1 (
    if exist "%PS_SCRIPT%" del /q "%PS_SCRIPT%" >nul 2>&1
    set "PI_MODELS_FILE="
    set "PI_PROXY_ORIGIN="
    echo   ERROR: Failed to update models.json proxy origin.
    exit /b 1
)

if exist "%PS_SCRIPT%" del /q "%PS_SCRIPT%" >nul 2>&1
set "PI_MODELS_FILE="
set "PI_PROXY_ORIGIN="
echo   Updated models.json proxy origin to %PROXY_ORIGIN%.
echo.
exit /b 0

:: -------------------------------------------------------
:: Usage - print command line options
:: -------------------------------------------------------
:Usage
echo Usage: %~nx0 [-y] [-h host]
echo.
echo Options:
echo   -y        Install without prompting; overwrite protected config files.
echo   -h host   Proxy host for models.json. Defaults to localhost.
echo             A bare host uses port 8383. host:port and full URLs are accepted.
goto :eof
