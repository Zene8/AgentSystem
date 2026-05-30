# tools/setup-runner.ps1
# Self-hosted runner setup for AgentSystem CI
# Run as Administrator
# Usage: powershell -ExecutionPolicy Bypass -File tools/setup-runner.ps1

param(
  [string]$RepoUrl   = "https://github.com/Zene8/AgentSystem",
  [string]$RunnerDir = "C:\actions-runner",
  [string]$Token     = $env:RUNNER_REG_TOKEN   # set via: gh api repos/Zene8/AgentSystem/actions/runners/registration-token
)

if (-not $Token) {
  Write-Error "Set RUNNER_REG_TOKEN env var first. Get token: gh api repos/Zene8/AgentSystem/actions/runners/registration-token --jq .token"
  exit 1
}

# Create runner dir
New-Item -ItemType Directory -Force -Path $RunnerDir | Out-Null

# Download latest runner
$version = "2.321.0"
$pkg = "actions-runner-win-x64-$version.zip"
$url = "https://github.com/actions/runner/releases/download/v$version/$pkg"
Write-Host "Downloading runner $version..."
Invoke-WebRequest -Uri $url -OutFile "$RunnerDir\$pkg"
Expand-Archive -Path "$RunnerDir\$pkg" -DestinationPath $RunnerDir -Force
Remove-Item "$RunnerDir\$pkg"

# Configure
Set-Location $RunnerDir
.\config.cmd --url $RepoUrl --token $Token --name "agentsystem-local" --labels "self-hosted,Windows,agentsystem" --unattended

# Install as Windows service
.\svc.cmd install
.\svc.cmd start

Write-Host "Runner installed and started. Verify: gh api repos/Zene8/AgentSystem/actions/runners"
