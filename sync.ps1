# sync.ps1 - Copy live ~/.pi config into this repo (native PowerShell)
# Usage:
#   .\sync.ps1              # interactive (prompts before overwriting protected files)
#   .\sync.ps1 -y           # overwrite protected config without prompting
#   .\sync.ps1 -Prune       # also delete repo files missing from live (mirror mode)
#
# Reverse of install.ps1. Content-aware: only writes when LF-normalized bytes differ,
# so identical files keep their mtimes and Git stays clean. Skips runtime/secrets and
# git submodules. Text files are normalized to LF (CRLF ignored).
#
# Default is additive: update/add from live, never delete repo-only files.
# The repo is the edit source of truth; live can lag or be partially wiped.
# Pass -Prune only when you intentionally want a live mirror.
[CmdletBinding()]
param(
    [switch]$y,
    [switch]$Prune
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:Copied  = 0
$script:Skipped = 0
$script:Updated = 0
$script:Removed = 0
$script:Unchanged = 0

$RepoRoot = $PSScriptRoot
$Source = Join-Path $HOME '.pi\agent'
$Target = Join-Path $RepoRoot '.pi\agent'
$ProtectedFiles = @('settings.json', 'models.json', 'models-store.json', 'damage-control-rules.yaml', 'SYSTEM.md', 'PREREQS.md')
$RootFiles = @('settings.json', 'models.json', 'models-store.json', 'damage-control-rules.yaml', 'SYSTEM.md', 'PREREQS.md')
$ManagedDirs = @('extensions', 'skills', 'themes')
$SkipDirNames = @('node_modules', '.git')
$SkipFileNames = @('package-lock.json', 'auth.json')
$TextExtensions = @(
    '.ts', '.js', '.mjs', '.cjs', '.json', '.md', '.yaml', '.yml', '.txt',
    '.css', '.html', '.htm', '.svg', '.xml', '.sh', '.bash', '.zsh',
    '.ps1', '.bat', '.cmd', '.py', '.toml', '.ini', '.cfg', '.conf',
    '.gitignore', '.gitattributes', '.npmrc', '.editorconfig'
)
$Utf8NoBom = New-Object System.Text.UTF8Encoding $false

if (-not (Test-Path $Source)) {
    Write-Host "ERROR: Live source directory not found: $Source"
    exit 1
}

Write-Host "Syncing $Source -> .pi\agent"
Write-Host ''

$OverwriteProtected = $false
if ($y) {
    $OverwriteProtected = $true
    Write-Host '  -y provided; will overwrite protected files in the repo.'
} else {
    $answer = Read-Host 'Overwrite protected config files in the repo (settings.json, models.json, etc.)? [y/N]'
    if ($answer -match '^(?i)y(es)?$') {
        $OverwriteProtected = $true
        Write-Host '  Will overwrite protected files.'
    } else {
        Write-Host '  Will skip protected files.'
    }
}
Write-Host ''

if (-not (Test-Path $Target)) { New-Item -ItemType Directory -Path $Target | Out-Null }

# -------------------------------------------------------
# Submodule paths relative to repo root (forward slashes)
# -------------------------------------------------------
function Get-SubmodulePaths {
    $gitmodules = Join-Path $RepoRoot '.gitmodules'
    $paths = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    if (-not (Test-Path $gitmodules)) { return $paths }
    foreach ($line in Get-Content -LiteralPath $gitmodules) {
        if ($line -match '^\s*path\s*=\s*(.+?)\s*$') {
            $p = $Matches[1].Trim() -replace '\\', '/'
            [void]$paths.Add($p)
        }
    }
    return $paths
}

$script:Submodules = Get-SubmodulePaths

function Get-RepoRelativePath {
    param([string]$FullPath)
    $full = [IO.Path]::GetFullPath($FullPath)
    $root = [IO.Path]::GetFullPath($RepoRoot).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    if ($full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
        return ($full.Substring($root.Length) -replace '\\', '/')
    }
    return ($full -replace '\\', '/')
}

function Test-IsUnderSubmodule {
    param([string]$FullPath)
    $rel = Get-RepoRelativePath $FullPath
    foreach ($sub in $script:Submodules) {
        if ($rel -eq $sub -or $rel.StartsWith("$sub/", [StringComparison]::OrdinalIgnoreCase)) {
            return $true
        }
    }
    return $false
}

function Test-IsTextFile {
    param([System.IO.FileInfo]$File)
    $ext = $File.Extension.ToLowerInvariant()
    $name = $File.Name
    if ($TextExtensions -contains $ext) { return $true }
    if ($TextExtensions -contains $name) { return $true }
    if ($name -eq 'LICENSE' -or $name -eq 'README' -or $name -like 'Makefile*') { return $true }
    return $false
}

function Get-NormalizedBytes {
    param([string]$Path)
    $bytes = [IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -eq 0) { return $bytes }
    if ($bytes -contains [byte]0) { return $bytes } # binary: keep as-is

    $file = Get-Item -LiteralPath $Path
    if (-not (Test-IsTextFile $file)) { return $bytes }

    $text = [Text.Encoding]::UTF8.GetString($bytes)
    $normalized = $text -replace "`r`n", "`n" -replace "`r", "`n"
    return $Utf8NoBom.GetBytes($normalized)
}

function Write-BytesIfChanged {
    param(
        [string]$DestPath,
        [byte[]]$NewBytes
    )
    $destDir = Split-Path -Parent $DestPath
    if (-not (Test-Path $destDir)) {
        New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    }

    if (Test-Path -LiteralPath $DestPath) {
        $old = [IO.File]::ReadAllBytes($DestPath)
        if ($old.Length -eq $NewBytes.Length) {
            $same = $true
            for ($i = 0; $i -lt $old.Length; $i++) {
                if ($old[$i] -ne $NewBytes[$i]) { $same = $false; break }
            }
            if ($same) {
                $script:Unchanged++
                return $false
            }
        }
    }

    [IO.File]::WriteAllBytes($DestPath, $NewBytes)
    $script:Updated++
    return $true
}

function Sync-File {
    param(
        [string]$SrcPath,
        [string]$DstPath
    )
    if (Test-IsUnderSubmodule $DstPath) { return }
    $bytes = Get-NormalizedBytes -Path $SrcPath
    [void](Write-BytesIfChanged -DestPath $DstPath -NewBytes $bytes)
}

function Sync-Dir {
    param(
        [string]$Src,
        [string]$Dst,
        [string]$Label
    )
    if (-not (Test-Path $Src)) { return }

    Write-Host "[$Label]"

    if (Test-IsUnderSubmodule $Dst) {
        Write-Host '  Skipping (git submodule).'
        Write-Host ''
        return
    }

    if (-not (Test-Path $Dst)) {
        New-Item -ItemType Directory -Path $Dst | Out-Null
    }

    $srcRoot = [IO.Path]::GetFullPath($Src).TrimEnd('\', '/')
    $dstRoot = [IO.Path]::GetFullPath($Dst).TrimEnd('\', '/')

    # Map relative path -> source file
    $srcFiles = @{}
    Get-ChildItem -LiteralPath $Src -Recurse -Force -ErrorAction SilentlyContinue | ForEach-Object {
        if ($_.PSIsContainer) {
            if ($SkipDirNames -contains $_.Name) { return }
            if ((Test-Path -LiteralPath (Join-Path $_.FullName '.git')) -or (Test-Path -LiteralPath (Join-Path $_.FullName '.git') -PathType Leaf)) {
                # nested git repo / submodule content in live tree: skip entire dir by not descending...
                # Get-ChildItem -Recurse still descends; mark by checking path components below
            }
            return
        }

        $full = $_.FullName
        $rel = $full.Substring($srcRoot.Length).TrimStart('\', '/')
        $parts = $rel -split '[\\/]'
        foreach ($part in $parts) {
            if ($SkipDirNames -contains $part) { return }
        }
        if ($SkipFileNames -contains $_.Name) { return }

        # Skip anything inside a .git directory path
        if ($rel -match '(?i)(^|[\\/])\.git([\\/]|$)') { return }

        # Skip live submodule checkouts under skills (repo-managed as submodules)
        $dstCandidate = Join-Path $dstRoot $rel
        if (Test-IsUnderSubmodule $dstCandidate) { return }

        # If any ancestor in source is a git checkout matching a repo submodule, skip
        $srcCandidateDir = Split-Path -Parent $full
        while ($srcCandidateDir -and $srcCandidateDir.Length -ge $srcRoot.Length) {
            $gitPath = Join-Path $srcCandidateDir '.git'
            if ((Test-Path -LiteralPath $gitPath)) {
                $relDir = $srcCandidateDir.Substring($srcRoot.Length).TrimStart('\', '/')
                $dstDir = if ($relDir) { Join-Path $dstRoot $relDir } else { $dstRoot }
                if (Test-IsUnderSubmodule $dstDir) { return }
            }
            $parent = Split-Path -Parent $srcCandidateDir
            if ($parent -eq $srcCandidateDir) { break }
            $srcCandidateDir = $parent
        }

        $srcFiles[$rel -replace '\\', '/'] = $full
    }

    foreach ($rel in ($srcFiles.Keys | Sort-Object)) {
        $srcPath = $srcFiles[$rel]
        $dstPath = Join-Path $dstRoot ($rel -replace '/', [IO.Path]::DirectorySeparatorChar)
        Sync-File -SrcPath $srcPath -DstPath $dstPath
    }

    # Optional mirror: remove dest files that are no longer in source (not submodules).
    # Off by default so repo-only work is never wiped when live lags.
    if ($Prune -and (Test-Path $Dst)) {
        Get-ChildItem -LiteralPath $Dst -Recurse -Force -File -ErrorAction SilentlyContinue | ForEach-Object {
            $full = $_.FullName
            if (Test-IsUnderSubmodule $full) { return }
            $rel = $full.Substring($dstRoot.Length).TrimStart('\', '/') -replace '\\', '/'
            $parts = $rel -split '/'
            foreach ($part in $parts) {
                if ($SkipDirNames -contains $part) { return }
            }
            if ($SkipFileNames -contains $_.Name) { return }
            if (-not $srcFiles.ContainsKey($rel)) {
                Remove-Item -LiteralPath $full -Force
                $script:Removed++
            }
        }

        # Remove empty dirs left behind (bottom-up), never submodule roots
        Get-ChildItem -LiteralPath $Dst -Recurse -Force -Directory -ErrorAction SilentlyContinue |
            Sort-Object { $_.FullName.Length } -Descending |
            ForEach-Object {
                if (Test-IsUnderSubmodule $_.FullName) { return }
                if ($SkipDirNames -contains $_.Name) { return }
                $children = Get-ChildItem -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
                if (-not $children -or @($children).Count -eq 0) {
                    Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
                }
            }
    }

    Write-Host '  Done.'
    $script:Copied++
    Write-Host ''
}

# --- Managed directories ---
foreach ($dir in $ManagedDirs) {
    Sync-Dir -Src (Join-Path $Source $dir) -Dst (Join-Path $Target $dir) -Label $dir
}

# --- Root-level files ---
Write-Host '[root files]'
foreach ($name in $RootFiles) {
    $src = Join-Path $Source $name
    if (-not (Test-Path $src)) { continue }
    $isProtected = $ProtectedFiles -contains $name
    if ($isProtected -and -not $OverwriteProtected) {
        Write-Host "  Skipping $name (protected)"
        $script:Skipped++
        continue
    }
    $dst = Join-Path $Target $name
    $before = $script:Updated
    Sync-File -SrcPath $src -DstPath $dst
    if ($script:Updated -gt $before) {
        Write-Host "  Updated $name"
    } else {
        Write-Host "  Unchanged $name"
    }
}
Write-Host ''

# --- Agents directory (sibling of agent/) ---
$agentsSrc = Join-Path $HOME '.pi\agents'
$agentsDst = Join-Path $RepoRoot '.pi\agents'
if (Test-Path $agentsSrc) {
    Write-Host '[agents]'
    if (-not (Test-Path $agentsDst)) { New-Item -ItemType Directory -Path $agentsDst | Out-Null }
    Get-ChildItem -Path $agentsSrc -Filter '*.md' -File -ErrorAction SilentlyContinue | ForEach-Object {
        $dst = Join-Path $agentsDst $_.Name
        $before = $script:Updated
        Sync-File -SrcPath $_.FullName -DstPath $dst
        if ($script:Updated -gt $before) {
            Write-Host "  Updated $($_.Name)"
        } else {
            Write-Host "  Unchanged $($_.Name)"
        }
    }
    Write-Host '  Done.'
    Write-Host ''
}

Write-Host ''
Write-Host '============================='
Write-Host ' Sync complete.'
Write-Host " Dirs synced: $script:Copied"
Write-Host " Files updated: $script:Updated"
Write-Host " Files unchanged: $script:Unchanged"
if ($Prune) {
    Write-Host " Files removed: $script:Removed"
} else {
    Write-Host ' Files removed: 0 (pass -Prune to delete repo files missing from live)'
}
Write-Host " Protected skipped: $script:Skipped"
Write-Host '============================='
Write-Host ''
Write-Host 'Skipped: auth.json, bin/, sessions/, node_modules, package-lock.json, git submodules'
Write-Host 'Text files normalized to LF (CRLF ignored).'
Write-Host 'Default is additive (no deletes). Use -Prune only to mirror-delete.'
Write-Host 'Review git status, then commit if the repo should keep these changes.'
