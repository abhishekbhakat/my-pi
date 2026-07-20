# install.ps1 - Copy .pi config from repo to ~/.pi (native PowerShell)
# Usage:
#   .\install.ps1              # interactive (prompts before overwriting protected files)
#   .\install.ps1 -y           # overwrite protected config without prompting
#   .\install.ps1 -h <host>    # set models.json proxy host
#
# Replaces each target subtree before copying, so stale files do not linger.
[CmdletBinding()]
param(
    [switch]$y,
    [string]$h
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:Copied  = 0
$script:Skipped = 0

$Source = Join-Path $PSScriptRoot '.pi\agent'
$Target = Join-Path $HOME '.pi\agent'
$ProtectedFiles = @('settings.json', 'models.json', 'damage-control-rules.yaml', 'SYSTEM.md', 'PREREQS.md')

# -------------------------------------------------------
# Validate and normalize the proxy host
# -------------------------------------------------------
$ProxyHostProvided = -not [string]::IsNullOrEmpty($h)
$ProxyOrigin = $null
if ($ProxyHostProvided) {
    if ($h -match '[\s"''`\\&|<>^!%]') {
        Write-Host 'ERROR: Proxy host contains invalid characters (spaces, quotes, ampersands, pipes, etc.).'
        exit 1
    }
    $origin = $h.TrimEnd('/')
    if ($origin -match '/v1$') { $origin = $origin.Substring(0, $origin.Length - 3).TrimEnd('/') }
    if ([string]::IsNullOrEmpty($origin)) {
        Write-Host 'ERROR: -h requires a non-empty host.'
        exit 1
    }
    if ($origin -notmatch '^https?://') {
        if ($origin.Contains(':')) { $origin = "http://$origin" }
        else { $origin = "http://${origin}:8383" }
    }
    $ProxyOrigin = $origin
}

if (-not (Test-Path $Source)) {
    Write-Host "ERROR: Source directory not found: $Source"
    exit 1
}

Write-Host "Copying .pi\agent -> $Target"
Write-Host ''

$OverwriteProtected = $false
if ($y) {
    $OverwriteProtected = $true
    Write-Host '  -y provided; will overwrite protected files.'
} else {
    $answer = Read-Host 'Overwrite protected config files (settings.json, models.json, etc.)? [y/N]'
    if ($answer -match '^(?i)y(es)?$') {
        $OverwriteProtected = $true
        Write-Host '  Will overwrite protected files.'
    } else {
        Write-Host '  Will skip protected files.'
    }
}
if ($ProxyHostProvided) {
    Write-Host "  Will set models.json proxy origin to $ProxyOrigin."
}
Write-Host ''

if (-not (Test-Path $Target)) { New-Item -ItemType Directory -Path $Target | Out-Null }

# -------------------------------------------------------
# CopyDir - replace a subtree, then copy source contents into it
# -------------------------------------------------------
function Copy-Dir {
    param([string]$Src, [string]$Dst)
    if (-not (Test-Path $Src)) { return }
    if (Test-Path $Dst) { Remove-Item -Recurse -Force $Dst }
    Copy-Item -Recurse $Src $Dst
    Get-ChildItem -Recurse -Filter 'package-lock.json' $Dst | Remove-Item -Force
    Write-Host '  Files copied.'
    $script:Copied++
}

# --- Extensions ---
Write-Host '[extensions]'
Copy-Dir (Join-Path $Source 'extensions') (Join-Path $Target 'extensions')
Write-Host ''

# --- npm install in extensions directory ---
Write-Host '[extensions npm]'
$extPkg = Join-Path $Target 'extensions\package.json'
if (Test-Path $extPkg) {
    if (Get-Command npm -ErrorAction SilentlyContinue) {
        Push-Location (Join-Path $Target 'extensions')
        try {
            npm install | Out-Null
            if ($LASTEXITCODE -eq 0) { Write-Host '  npm install complete.' }
            else { Write-Host '  WARNING: npm install failed.' }
        } finally { Pop-Location }
    } else {
        Write-Host '  npm not found; skipping npm install.'
    }
}
Write-Host ''

# --- Skills ---
Write-Host '[skills]'
Copy-Dir (Join-Path $Source 'skills') (Join-Path $Target 'skills')
Write-Host ''

# --- Themes ---
Write-Host '[themes]'
Copy-Dir (Join-Path $Source 'themes') (Join-Path $Target 'themes')
Write-Host ''

# --- Root-level files (settings, models, rules, etc.) ---
Write-Host '[root files]'
foreach ($name in $ProtectedFiles) {
    $src = Join-Path $Source $name
    if (-not (Test-Path $src)) { continue }
    if (-not $OverwriteProtected) {
        Write-Host "  Skipping $name (protected)"
        $script:Skipped++
    } else {
        Copy-Item -Force $src (Join-Path $Target $name)
        Write-Host "  Copied $name"
        $script:Copied++
    }
}
Write-Host ''

# --- Patch models.json proxy origin ---
if ($ProxyHostProvided) {
    Write-Host '[models proxy]'
    $modelsFile = Join-Path $Target 'models.json'
    if (Test-Path $modelsFile) {
        $text = [IO.File]::ReadAllText($modelsFile)
        $pattern = '("baseUrl"\s*:\s*").*?(")'
        $text = [regex]::Replace($text, $pattern, {
            param($m)
            $suffix = if ($m.Value.EndsWith('/v1"')) { '/v1' } else { '' }
            $m.Groups[1].Value + $ProxyOrigin + $suffix + $m.Groups[2].Value
        })
        [IO.File]::WriteAllText($modelsFile, $text, (New-Object System.Text.UTF8Encoding $false))
        Write-Host "  Updated models.json proxy origin to $ProxyOrigin."
    } else {
        Write-Host '  Skipping proxy update; models.json not found.'
    }
    Write-Host ''
}

# --- Agents directory (sibling of agent/) ---
$agentsSrc = Join-Path $PSScriptRoot '.pi\agents'
$agentsDst = Join-Path $HOME '.pi\agents'
if (Test-Path $agentsSrc) {
    Write-Host '[agents]'
    if (Test-Path $agentsDst) { Remove-Item -Recurse -Force $agentsDst }
    New-Item -ItemType Directory -Path $agentsDst | Out-Null
    Copy-Item (Join-Path $agentsSrc '*.md') $agentsDst -ErrorAction SilentlyContinue
    Write-Host '  Done.'
    Write-Host ''
}

Write-Host ''
Write-Host '============================='
Write-Host ' Copy complete.'
Write-Host " Copied: $script:Copied"
Write-Host " Skipped: $script:Skipped"
Write-Host '============================='
Write-Host ''
Write-Host 'Run /reload in pi to pick up changes.'
