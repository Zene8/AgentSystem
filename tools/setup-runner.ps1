#Requires -Version 5.1
<#
.SYNOPSIS
    One-time setup of a self-hosted GitHub Actions runner on this Windows machine.
    After running this, the runner starts as a Windows service (always-on).

.DESCRIPTION
    Downloads the runner, configures it against this repo, and installs as a
    Windows service so it survives reboots.

    PREREQUISITES:
    1. gh CLI authenticated: gh auth status
    2. You have admin rights on this machine (service install requires elevation)
    3. Repo is set in environment or passed as -RepoUrl

.PARAMETER RepoUrl
    GitHub repo URL, e.g. https://github.com/nathanjones/AgentSystem
    Defaults to reading from: gh repo view --json url -q .url

.PARAMETER RunnerDir
    Where to install the runner. Defaults to C:\actions-runner
#>
param(
    [string]$RepoUrl = "",
    [string]$RunnerDir = "C:\actions-runner"
)

$ErrorActionPreference = "Stop"

# Get repo URL if not provided
if (-not $RepoUrl) {
    $RepoUrl = gh repo view --json url -q .url 2>$null
    if (-not $RepoUrl) {
        Write-Error "Could not determine repo URL. Pass -RepoUrl https://github.com/owner/repo"
        exit 1
    }
}

Write-Host "Setting up self-hosted runner for: $RepoUrl" -ForegroundColor Cyan
Write-Host "Runner directory: $RunnerDir" -ForegroundColor Gray

# Create runner directory
if (-not (Test-Path $RunnerDir)) {
    New-Item -ItemType Directory -Force $RunnerDir | Out-Null
}

# Download latest runner
$apiUrl = "https://api.github.com/repos/actions/runner/releases/latest"
$latest = Invoke-RestMethod $apiUrl
$asset = $latest.assets | Where-Object { $_.name -like "*win-x64*.zip" } | Select-Object -First 1
if (-not $asset) {
    Write-Error "Could not find Windows x64 runner asset"
    exit 1
}

$zipPath = "$env:TEMP\actions-runner.zip"
Write-Host "  Downloading runner: $($asset.name)" -ForegroundColor Gray
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath
Expand-Archive -Path $zipPath -DestinationPath $RunnerDir -Force
Remove-Item $zipPath

# Get registration token via gh CLI
Write-Host "  Getting registration token..." -ForegroundColor Gray
$repoPath = $RepoUrl -replace "https://github.com/", ""
$tokenResp = gh api -X POST "repos/$repoPath/actions/runners/registration-token" 2>$null | ConvertFrom-Json
if (-not $tokenResp.token) {
    Write-Error "Failed to get registration token. Ensure gh is authenticated with repo admin scope."
    exit 1
}

# Configure runner
Push-Location $RunnerDir
Write-Host "  Configuring runner..." -ForegroundColor Gray
& .\config.cmd `
    --url $RepoUrl `
    --token $tokenResp.token `
    --name "$env:COMPUTERNAME-agent-runner" `
    --labels "self-hosted,Windows,agent-runner" `
    --work "_work" `
    --unattended

# Install as Windows service
Write-Host "  Installing as Windows service..." -ForegroundColor Gray
& .\svc.cmd install
& .\svc.cmd start
Pop-Location

Write-Host ""
Write-Host "Runner installed and started as Windows service." -ForegroundColor Green
Write-Host "Verify at: $RepoUrl/settings/actions/runners"
Write-Host ""
Write-Host "Phone workflow:"
Write-Host "  1. Open GitHub mobile app"
Write-Host "  2. New Issue -> use 'Agent Task' template"
Write-Host "  3. Add label: agent:friday (or any agent)"
Write-Host "  4. Watch for result comment notification"
