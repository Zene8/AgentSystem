# Synchronize agent files from repo (source) to Claude/Gemini/Copilot config dirs
# Usage: powershell.exe -File sync_agents_from_repo.ps1
# This makes the repo the single source of truth. Edits in repo/ sync outward.

param(
    [switch]$Verbose,
    [string]$Username = $env:USERNAME  # Windows username for path construction
)

$repoDir = (Get-Location).Path
$claudeDir = "$env:USERPROFILE\.claude\agents"
$geminiDir = "$env:USERPROFILE\.gemini\agents"
$copilotDir = "$env:USERPROFILE\.copilot\agents"

Write-Host "Syncing agents from repo to CLI config dirs..."
Write-Host "Source (repo): $repoDir"
Write-Host "Target (Claude): $claudeDir"
Write-Host "Target (Gemini): $geminiDir"
Write-Host "Target (Copilot): $copilotDir"
Write-Host ""

$clis = @(
    @{ name = "Claude"; src = "claude"; dst = $claudeDir }
    @{ name = "Gemini"; src = "gemini"; dst = $geminiDir }
    @{ name = "Copilot"; src = "copilot"; dst = $copilotDir }
)

$totalSynced = 0

foreach ($cli in $clis) {
    $srcPath = Join-Path $repoDir $cli.src
    $dstPath = $cli.dst

    if (-not (Test-Path $srcPath)) {
        Write-Host "WARNING: $($cli.name) repo dir not found: $srcPath"
        continue
    }

    # Ensure dest dir exists
    if (-not (Test-Path $dstPath)) {
        New-Item -ItemType Directory -Force -Path $dstPath | Out-Null
    }

    # Copy all subdirs and files
    Copy-Item -Path "$srcPath\*" -Destination $dstPath -Recurse -Force | Out-Null

    $count = @(Get-ChildItem -Path $srcPath -Recurse -File).Count
    Write-Host "OK $($cli.name): $count files synced"
    $totalSynced += $count
}

Write-Host ""
Write-Host "Complete: $totalSynced files synced from repo to all CLI config dirs"
Write-Host "Repo is now the source of truth. Commit changes here, then run this script."
