#Requires -Version 5.1
<#
.SYNOPSIS
  Installs the "Chat" agent preset and the code-tutor skill into a DeepSeek Harness home.

.DESCRIPTION
  Idempotent: re-running replaces the previous install. Works on Windows
  PowerShell 5.1+ and PowerShell 7+.

  Text files are read and written as UTF-8 without a byte-order mark, and line
  endings are preserved. The Windows PowerShell 5.1 text cmdlets
  (Get-Content/Set-Content/Out-File) are deliberately avoided here: without an
  explicit -Encoding they use the ANSI code page and corrupt non-ASCII
  characters, and -Encoding utf8 writes a BOM.

.PARAMETER Profile
  DSH profile to install the preset into. Defaults to $env:DSH_PROFILE, else "desktop".

.PARAMETER DshHome
  DSH home directory. Defaults to $env:DSH_HOME, else ~/.dsh.

.PARAMETER NoGlobalSkill
  Do not also expose code-tutor to every other preset.

.EXAMPLE
  ./scripts/install.ps1
.EXAMPLE
  ./scripts/install.ps1 -Profile desktop -DshHome C:\Users\me\.dsh
#>
[CmdletBinding()]
param(
    [string]$Profile,
    [string]$DshHome,
    [switch]$NoGlobalSkill
)

$ErrorActionPreference = 'Stop'

# UTF-8, no BOM, forward-compatible with both PowerShell editions.
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Read-TextFile {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    return [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
}

function Write-TextFile {
    param([string]$Path, [string]$Content)
    $dir = Split-Path -Parent $Path
    if ($dir -and -not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }
    [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$presetSrc = Join-Path $repoRoot 'preset/chat.patch.yml'
$skillSrc = Join-Path $repoRoot 'skills/code-tutor/SKILL.md'

if (-not $Profile -or $Profile.Trim() -eq '') {
    $Profile = if ($env:DSH_PROFILE) { $env:DSH_PROFILE } else { 'desktop' }
}
if (-not $DshHome -or $DshHome.Trim() -eq '') {
    $DshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
}

$patchFile = Join-Path $DshHome "profiles/$Profile/cordis.patch.yml"
$presetSkillDir = Join-Path $DshHome 'presets/chat/skills/code-tutor'
$globalSkillDir = Join-Path $DshHome 'skills/code-tutor'

$beginMark = '# >>> dsh-chat-preset (managed block - do not edit by hand) >>>'
$endMark = '# <<< dsh-chat-preset <<<'

foreach ($f in @($presetSrc, $skillSrc)) {
    if (-not (Test-Path -LiteralPath $f -PathType Leaf)) {
        throw "missing repository file: $f"
    }
}

Write-Host "DSH home : $DshHome"
Write-Host "Profile  : $Profile"

# ---- 1. the code-tutor skill ---------------------------------------------
New-Item -ItemType Directory -Force -Path $presetSkillDir | Out-Null
Copy-Item -LiteralPath $skillSrc -Destination (Join-Path $presetSkillDir 'SKILL.md') -Force
Write-Host "skill    -> $(Join-Path $presetSkillDir 'SKILL.md')"

if (-not $NoGlobalSkill) {
    New-Item -ItemType Directory -Force -Path $globalSkillDir | Out-Null
    Copy-Item -LiteralPath $skillSrc -Destination (Join-Path $globalSkillDir 'SKILL.md') -Force
    Write-Host "skill    -> $(Join-Path $globalSkillDir 'SKILL.md')  (usable by other presets)"
}

# ---- 2. the preset row in the profile patch -------------------------------
$existing = Read-TextFile -Path $patchFile
if ($null -eq $existing) {
    $existing = "# Your patch layer for this dsh profile, applied after every bundle layer.$([char]10)"
    Write-Host "created  -> $patchFile"
}

# Split on LF only, so LF files stay LF and CRLF files are re-joined as CRLF.
$newline = if ($existing.Contains("`r`n")) { "`r`n" } else { "`n" }
$lines = $existing -split "`n" | ForEach-Object { $_.TrimEnd("`r") }

$kept = New-Object System.Collections.Generic.List[string]
$skipping = $false
foreach ($line in $lines) {
    if ($line.TrimEnd() -ceq $beginMark) { $skipping = $true; continue }
    if ($line.TrimEnd() -ceq $endMark) { $skipping = $false; continue }
    if (-not $skipping) { $kept.Add($line) }
}
# Drop the trailing blank lines the previous block left behind, so repeated
# installs are idempotent.
while ($kept.Count -gt 0 -and $kept[$kept.Count - 1].Trim() -eq '') {
    $kept.RemoveAt($kept.Count - 1)
}

$presetText = [System.IO.File]::ReadAllText($presetSrc, [System.Text.Encoding]::UTF8).Replace("`r`n", "`n").TrimEnd("`n")
$blockText = $beginMark + "`n" + $presetText + "`n" + $endMark

$final = ($kept -join $newline)
if ($final.Length -gt 0) { $final += $newline }
$final += $newline + $blockText + $newline

Write-TextFile -Path $patchFile -Content $final
Write-Host "preset   -> $patchFile"

Write-Host ''
Write-Host 'Installed. Restart DeepSeek Harness and pick the "Chat" preset for a new'
Write-Host 'session (Settings -> Agent presets, or the preset picker in the composer).'
Write-Host 'Verify the install with: powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1'
