:; if command -v cygpath >/dev/null 2>&1; then exec cmd.exe /c "$(cygpath -w "$0")" "$@"; elif command -v wslpath >/dev/null 2>&1; then exec cmd.exe /c "$(wslpath -w "$0")" "$@"; else exec cmd.exe /c "$0" "$@"; fi # 2>/dev/null
@echo off
setlocal

:: sync.bat - thin wrapper around sync.ps1 (content-aware LF sync)

set "SCRIPT_DIR=%~dp0"
set "PS1=%SCRIPT_DIR%sync.ps1"

if not exist "%PS1%" (
    echo ERROR: sync.ps1 not found next to sync.bat
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
exit /b %ERRORLEVEL%
