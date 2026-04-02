:; if command -v cygpath >/dev/null 2>&1; then exec cmd.exe /c "$(cygpath -w "$0")" "$@"; elif command -v wslpath >/dev/null 2>&1; then exec cmd.exe /c "$(wslpath -w "$0")" "$@"; else exec cmd.exe /c "$0" "$@"; fi # 2>/dev/null
@echo off
setlocal enabledelayedexpansion

:: install.bat - Sync .pi config from repo to ~/.pi
:: If invoked from a POSIX-like shell (Git Bash/WSL/MSYS), the first line
:: re-execs this script via cmd.exe so shell redirections do not create a
:: literal "nul" file in the working directory.
:: Mirrors repo structure onto target, but does NOT delete extra files
:: in target (e.g. node_modules, sessions, auth.json, bin, etc.)

set "SOURCE=%~dp0.pi\agent"
set "TARGET=%USERPROFILE%\.pi\agent"

if not exist "%SOURCE%" (
    echo ERROR: Source directory not found: %SOURCE%
    exit /b 1
)

echo Syncing .pi\agent -^> %TARGET%
echo.

:: Files to never overwrite (user-specific config that may differ from repo)
set "PROTECTED_FILES=settings.json models.json damage-control-rules.yaml SYSTEM.md PREREQS.md"

:: Ask about protected files
set "OVERWRITE_PROTECTED="
set /p "OVERWRITE_PROTECTED=Overwrite protected config files (settings.json, models.json, etc.)? [y/N]: "
if /i "!OVERWRITE_PROTECTED!"=="y" (
    echo   Will overwrite protected files.
) else (
    echo   Will skip protected files.
)
echo.

:: Create target base directory
if not exist "%TARGET%" mkdir "%TARGET%"

:: Counters
set /a COPIED=0
set /a SKIPPED=0

:: --- Sync extensions, skills, themes, and root-level files ---
:: We use robocopy for each section with /MIR-like behavior but /XX to not delete extras

:: Extensions (copy files, don't purge extras like node_modules)
echo [extensions]
call :SyncDir "%SOURCE%\extensions" "%TARGET%\extensions"
echo.

:: Skills
echo [skills]
call :SyncDir "%SOURCE%\skills" "%TARGET%\skills"
echo.

:: Themes
echo [themes]
call :SyncDir "%SOURCE%\themes" "%TARGET%\themes"
echo.

:: Root-level files (settings, models, rules, etc.)
echo [root files]
call :SyncRootFiles
echo.

:: --- Sync agents directory (sibling of agent/) ---
set "AGENTS_SRC=%~dp0.pi\agents"
set "AGENTS_DST=%USERPROFILE%\.pi\agents"
if exist "%AGENTS_SRC%" (
    echo [agents]
    if not exist "%AGENTS_DST%" mkdir "%AGENTS_DST%"
    robocopy "%AGENTS_SRC%" "%AGENTS_DST%" *.md /njh /njs /ndl /nc /ns /np
    echo   Done.
    echo.
)

echo.
echo =============================
echo  Sync complete.
echo  Copied: !COPIED!
echo  Skipped: !SKIPPED!
echo =============================
echo.
echo Run /reload in pi to pick up changes.
goto :eof

:: -------------------------------------------------------
:: SyncDir - robocopy a subtree, preserving extras in target
:: Args: %1=source %2=target
:: -------------------------------------------------------
:SyncDir
set "SD_SRC=%~1"
set "SD_DST=%~2"
if not exist "%SD_SRC%" goto :eof
if not exist "%SD_DST%" mkdir "%SD_DST%"

:: /E    - copy subdirs including empty
:: /XX   - don't delete extra files/dirs in target (e.g. node_modules)
:: /XL   - don't delete "lonely" files in target
:: /NJH  - no job header
:: /NJS  - no job summary
:: /NDL  - no directory list
:: /NC   - no file class
:: /NS   - no file size
:: /NP   - no progress
:: /XF   - exclude package-lock.json (user generates their own)
robocopy "%SD_SRC%" "%SD_DST%" /E /XX /XL /njh /njs /ndl /nc /ns /np /xf "package-lock.json" >nul 2>&1

:: Count items copied (robocopy returns: 0=no change, 1=copied, 2=extras, etc.)
:: We just report based on return code
if %ERRORLEVEL% EQU 1 (
    echo   Files synced.
    set /a COPIED+=1
) else if %ERRORLEVEL% EQU 3 (
    echo   Files synced ^(some extras in target preserved^).
    set /a COPIED+=1
) else if %ERRORLEVEL% EQU 0 (
    echo   Already up to date.
    set /a SKIPPED+=1
) else if %ERRORLEVEL% GEQ 8 (
    echo   WARNING: robocopy error level %ERRORLEVEL%
)
goto :eof

:: -------------------------------------------------------
:: SyncRootFiles - copy individual root-level config files
:: -------------------------------------------------------
:SyncRootFiles
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
