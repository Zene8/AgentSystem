#Requires -Version 5.1
<#
.SYNOPSIS
    First-time AgentSystem setup on a new machine. Idempotent -- safe to re-run.

.DESCRIPTION
    1. Checks prerequisites (node, git, gh, CLIs)
    2. Initializes personal brain
    3. Syncs agents to all CLIs (~/.claude, ~/.copilot, ~/.gemini)
    4. Creates GitHub labels in current repo
    5. Optionally sets up self-hosted runner (requires admin, use -Runner flag)

.PARAMETER Name
    Your name for the personal brain. Defaults to git user.name.

.PARAMETER Email
    Your email for the personal brain. Defaults to git user.email.

.PARAMETER Runner
    Also set up the self-hosted GitHub Actions runner (requires admin rights).

.PARAMETER SkipLabels
    Skip creating GitHub labels (useful if not in a repo yet).

.EXAMPLE
    .\install.ps1
    .\install.ps1 -Name "Nathan" -Email "nathan@arborgenie.com"
    .\install.ps1 -Runner
#>
param(
    [string]$Name  = "",
    [string]$Email = "",
    [switch]$Runner,
    [switch]$SkipLabels
)

$ErrorActionPreference = "Stop"
$ScriptDir = $PSScriptRoot

function Write-Step  { param($msg) Write-Host "`n>> $msg" -ForegroundColor Cyan }
function Write-OK    { param($msg) Write-Host "   OK  $msg" -ForegroundColor Green }
function Write-Skip  { param($msg) Write-Host "   --  $msg" -ForegroundColor Gray }
function Write-Warn  { param($msg) Write-Host "   !!  $msg" -ForegroundColor Yellow }
function Write-Fail  { param($msg) Write-Host "   XX  $msg" -ForegroundColor Red }

$Status = @{ pass = 0; warn = 0; fail = 0 }

# 1. Prerequisites
Write-Step "Checking prerequisites"

$prereqs = @{
    node = "node --version"
    git  = "git --version"
    gh   = "gh --version"
}
foreach ($p in $prereqs.GetEnumerator()) {
    $found = Get-Command $p.Key -ErrorAction SilentlyContinue
    if ($found) {
        $ver = & $p.Key --version 2>$null | Select-Object -First 1
        Write-OK "$($p.Key)  $ver"
        $Status.pass++
    } else {
        Write-Fail "$($p.Key) not found - install before continuing"
        $Status.fail++
    }
}

foreach ($cli in @("claude", "gemini", "copilot")) {
    $found = Get-Command $cli -ErrorAction SilentlyContinue
    if ($found) { Write-OK "$cli CLI found" }
    else { Write-Warn "$cli CLI not found (sync will skip it)" }
}

if ($Status.fail -gt 0) {
    Write-Host "`nFATAL: $($Status.fail) required prerequisite(s) missing. Fix above, then re-run." -ForegroundColor Red
    exit 1
}

# 2. Personal brain
Write-Step "Initializing personal brain"

if (-not $Name)  { try { $Name  = git config user.name  2>$null } catch {} }
if (-not $Email) { try { $Email = git config user.email 2>$null } catch {} }
if (-not $Name)  { $Name = "User" }

$brainScript = Join-Path $ScriptDir "tools\personal-brain-init.js"
if (Test-Path $brainScript) {
    node $brainScript --name="$Name" --email="$Email"
    Write-OK "Personal brain ready"
    $Status.pass++
} else {
    Write-Warn "personal-brain-init.js not found at $brainScript"
    $Status.warn++
}

# 3. Sync agents to all CLIs
Write-Step "Syncing agents to all CLIs"

$syncScript = Join-Path $ScriptDir "sync_agents_from_repo.ps1"
if (Test-Path $syncScript) {
    powershell -File $syncScript
    Write-OK "Agents synced"
    $Status.pass++
} else {
    Write-Fail "sync_agents_from_repo.ps1 not found"
    $Status.fail++
}

# 4. GitHub labels
if (-not $SkipLabels) {
    Write-Step "Creating GitHub labels"
    $ghAuth = gh auth status 2>&1
    if ($LASTEXITCODE -eq 0) {
        $labelScript = Join-Path $ScriptDir "tools\create-agent-labels.ps1"
        if (Test-Path $labelScript) {
            powershell -File $labelScript
            $Status.pass++
        } else {
            Write-Warn "create-agent-labels.ps1 not found"
            $Status.warn++
        }
    } else {
        Write-Warn "gh not authenticated - skipping labels (run: gh auth login)"
        $Status.warn++
    }
} else {
    Write-Skip "Labels skipped (-SkipLabels)"
}

# 5. Self-hosted runner (optional)
if ($Runner) {
    Write-Step "Setting up self-hosted runner"
    $runnerScript = Join-Path $ScriptDir "tools\setup-runner.ps1"
    if (Test-Path $runnerScript) {
        $identity  = [Security.Principal.WindowsIdentity]::GetCurrent()
        $principal = [Security.Principal.WindowsPrincipal]$identity
        $isAdmin   = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
        if ($isAdmin) {
            powershell -File $runnerScript
            $Status.pass++
        } else {
            Write-Warn "Runner install requires admin. Re-run as Administrator with -Runner flag."
            $Status.warn++
        }
    } else {
        Write-Warn "setup-runner.ps1 not found"
        $Status.warn++
    }
} else {
    Write-Skip "Runner setup skipped (add -Runner flag when ready, requires admin)"
}

# Summary
Write-Host ""
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host " AgentSystem install complete" -ForegroundColor Cyan
Write-Host "  Pass: $($Status.pass)  Warn: $($Status.warn)  Fail: $($Status.fail)" -ForegroundColor Cyan
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host ""
Write-Host " Start working:"
Write-Host "   claude @friday              - engineering tasks"
Write-Host "   claude @jarvis              - strategy / cross-domain"
Write-Host "   claude @nat                 - business / GTM"
Write-Host ""
Write-Host " New repo:"
Write-Host "   powershell -File tools\bootstrap-repo.ps1"
Write-Host ""
Write-Host " After editing agents:"
Write-Host "   powershell -File sync_agents_from_repo.ps1"
Write-Host ""
if ($Status.warn -gt 0) {
    Write-Host " Warnings above - check output and re-run if needed." -ForegroundColor Yellow
}
if (-not $Runner) {
    Write-Host " Runner not set up - CI workflows wont run until you do:" -ForegroundColor Yellow
    Write-Host "   Run PowerShell as Administrator, then: .\install.ps1 -Runner" -ForegroundColor Yellow
}
