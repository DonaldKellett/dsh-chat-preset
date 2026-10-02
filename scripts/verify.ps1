#Requires -Version 5.1
<#
.SYNOPSIS
  Verifies an installed Chat preset and code-tutor skill.

.DESCRIPTION
  Thin wrapper around scripts/verify.mjs. It locates a usable Node.js, including
  the one bundled with the DeepSeek Harness desktop app, and hands over.

.PARAMETER Profile
  DSH profile to check. Defaults to $env:DSH_PROFILE, else "desktop".

.PARAMETER DshHome
  DSH home directory. Defaults to $env:DSH_HOME, else ~/.dsh.

.PARAMETER DshRoot
  A DeepSeek Harness source checkout, if you have one.

.PARAMETER Quiet
  Print one line per check instead of full detail.

.EXAMPLE
  ./scripts/verify.ps1
#>
[CmdletBinding()]
param(
    [string]$Profile,
    [string]$DshHome,
    [string]$DshRoot,
    [switch]$Quiet
)

$ErrorActionPreference = 'Continue'

$verify = Join-Path $PSScriptRoot 'verify.mjs'
$nodeArgs = @($verify)
if ($Profile) { $nodeArgs += @('--profile', $Profile) }
if ($DshHome) { $nodeArgs += @('--dsh-home', $DshHome) }
if ($DshRoot) { $nodeArgs += @('--dsh-root', $DshRoot) }
if ($Quiet) { $nodeArgs += '--quiet' }

$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
    & $node.Source @nodeArgs
    exit $LASTEXITCODE
}

$candidates = @()
if ($env:DSH_BUNDLED_NODE) { $candidates += $env:DSH_BUNDLED_NODE }
$programFilesX86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
foreach ($base in @($env:LOCALAPPDATA, $env:ProgramFiles, $programFilesX86)) {
    if (-not $base) { continue }
    $candidates += Join-Path $base 'Programs/DeepSeek Harness/resources/runtime/primary-runtime/dependencies/node/bin/node.exe'
    $candidates += Join-Path $base 'DeepSeek Harness/resources/runtime/primary-runtime/dependencies/node/bin/node.exe'
}

foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        & $candidate @nodeArgs
        exit $LASTEXITCODE
    }
}

Write-Error 'no Node.js found. Install Node.js 22+, or set DSH_BUNDLED_NODE to the bundled node.exe.'
exit 1
