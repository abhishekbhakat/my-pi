:; if command -v cygpath >/dev/null 2>&1; then exec cmd.exe /c "$(cygpath -w "$0")" "$@"; elif command -v wslpath >/dev/null 2>&1; then exec cmd.exe /c "$(wslpath -w "$0")" "$@"; else exec cmd.exe /c "$0" "$@"; fi # 2>/dev/null
@echo off
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

:: --- Copy extensions, skills, themes, and root-level files ---
:: Each subtree is removed first, then copied into a fresh target directory.

:: Extensions
echo [extensions]
call :CopyDir "%SOURCE%\extensions" "%TARGET%\extensions"
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
