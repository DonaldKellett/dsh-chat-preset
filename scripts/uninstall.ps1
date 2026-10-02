#Requires -Version 5.1
<#
.SYNOPSIS
  Removes the "Chat" agent preset and the code-tutor skill from a DeepSeek Harness home.

.DESCRIPTION
  Removes only the managed preset block this project installed, plus the skill
  copies it created. Your own edits elsewhere in the profile patch are untouched.

  Text files are read and written as UTF-8 without a byte-order mark, and line
  endings are preserved. The Windows PowerShell 5.1 text cmdlets
  (Get-Content/Set-Content/Out-File) are deliberately avoided here: without an
  explicit -Encoding they use the ANSI code page and corrupt non-ASCII
  characters, and -Encoding utf8 writes a BOM.

.PARAMETER Profile
  DSH profile the preset was installed into. Defaults to $env:DSH_PROFILE, else "desktop".

.PARAMETER DshHome
  DSH home directory. Defaults to $env:DSH_HOME, else ~/.dsh.

.PARAMETER KeepGlobalSkill
  Leave $DshHome/skills/code-tutor in place.

.EXAMPLE
  ./scripts/uninstall.ps1
#>
[CmdletBinding()]
param(
    [string]$Profile,
    [string]$DshHome,
    [switch]$KeepGlobalSkill
)

$ErrorActionPreference = 'Stop'

# UTF-8, no BOM, forward-compatible with both PowerShell editions.
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

if (-not $Profile -or $Profile.Trim() -eq '') {
    $Profile = if ($env:DSH_PROFILE) { $env:DSH_PROFILE } else { 'desktop' }
}
if (-not $DshHome -or $DshHome.Trim() -eq '') {
    $DshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
}

$patchFile = Join-Path $DshHome "profiles/$Profile/cordis.patch.yml"
$presetRoot = Join-Path $DshHome 'presets/chat'
$presetSkillsRoot = Join-Path $presetRoot 'skills'
$presetSkillDir = Join-Path $presetSkillsRoot 'code-tutor'
$globalSkillDir = Join-Path $DshHome 'skills/code-tutor'

$beginMark = '# >>> dsh-chat-preset (managed block - do not edit by hand) >>>'
$endMark = '# <<< dsh-chat-preset <<<'

Write-Host "DSH home : $DshHome"
Write-Host "Profile  : $Profile"

# ---- 1. the preset row ---------------------------------------------------
if (Test-Path -LiteralPath $patchFile -PathType Leaf) {
    $existing = [System.IO.File]::ReadAllText($patchFile, [System.Text.Encoding]::UTF8)
    $newline = if ($existing.Contains("`r`n")) { "`r`n" } else { "`n" }
    $lines = $existing -split "`n" | ForEach-Object { $_.TrimEnd("`r") }

    $kept = New-Object System.Collections.Generic.List[string]
    $skipping = $false
    foreach ($line in $lines) {
        if ($line.TrimEnd() -ceq $beginMark) { $skipping = $true; continue }
        if ($line.TrimEnd() -ceq $endMark) { $skipping = $false; continue }
        if (-not $skipping) { $kept.Add($line) }
    }
    # Installing the block adds one leading blank line; drop a trailing blank run
    # so an install/uninstall cycle leaves the file exactly as it was found.
    while ($kept.Count -gt 0 -and $kept[$kept.Count - 1].Trim() -eq '') {
        $kept.RemoveAt($kept.Count - 1)
    }

    $final = ($kept -join $newline)
    if ($final.Length -gt 0) { $final += $newline }
    [System.IO.File]::WriteAllText($patchFile, $final, $utf8NoBom)
    Write-Host "preset   <- removed managed block from $patchFile"
}
else {
    Write-Host "preset   -- $patchFile not found, nothing to remove"
}

# ---- 2. the skill --------------------------------------------------------
if (Test-Path -LiteralPath $presetSkillDir) {
    Remove-Item -LiteralPath $presetSkillDir -Recurse -Force
    Write-Host "skill    <- removed $presetSkillDir"
}
foreach ($dir in @($presetSkillsRoot, $presetRoot)) {
    if ((Test-Path -LiteralPath $dir -PathType Container) -and
        @(Get-ChildItem -LiteralPath $dir -Force).Count -eq 0) {
        Remove-Item -LiteralPath $dir -Force
    }
}

if (-not $KeepGlobalSkill -and (Test-Path -LiteralPath $globalSkillDir)) {
    Remove-Item -LiteralPath $globalSkillDir -Recurse -Force
    Write-Host "skill    <- removed $globalSkillDir"
}

Write-Host ''
Write-Host 'Uninstalled. Restart DeepSeek Harness for the roster change to take effect.'
