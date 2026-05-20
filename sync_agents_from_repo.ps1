# sync_agents_from_repo.ps1 — Unified agent definition sync from master to all CLIs

param(
    [string]$LogFile = ".agents/sync.log"
)

# Helper: Write timestamped status to console and log file
function Write-Status {
    param(
        [string]$Message,
        [ValidateSet("SUCCESS", "ERROR", "INFO")]
        [string]$Type = "INFO"
    )

    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $color = switch ($Type) {
        "SUCCESS" { "Green" }
        "ERROR" { "Red" }
        "INFO" { "Cyan" }
    }

    $output = "[$timestamp] [$Type] $Message"
    Write-Host $output -ForegroundColor $color
    Add-Content -Path $LogFile -Value $output -Encoding UTF8
}

# Helper: Get master agent definition file content
function Get-MasterAgentDefinition {
    param([string]$AgentName)

    $mastePath = ".agents/agents/$AgentName.md"

    if (-not (Test-Path $mastePath)) {
        Write-Status "ERROR: Master definition not found: $mastePath" "ERROR"
        return $null
    }

    $content = Get-Content -Path $mastePath -Raw -Encoding UTF8

    if (-not $content) {
        Write-Status "ERROR: Master file empty or unreadable: $mastePath" "ERROR"
        return $null
    }

    $requiredFields = @("name:", "description:", "argument-hint:", "tools:", "behavior:")
    foreach ($field in $requiredFields) {
        if (-not ($content -cmatch $field)) {
            Write-Status "ERROR: Missing required field '$field' in $mastePath" "ERROR"
            return $null
        }
    }

    return $content
}

# Helper: Initialize required directories before first Write-Status call
function Initialize-LogDirectory {
    $logDir = Split-Path -Path $LogFile
    if ($logDir -and -not (Test-Path $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }

    $claudeDir = ".claude/agents"
    if (-not (Test-Path $claudeDir)) {
        New-Item -ItemType Directory -Path $claudeDir -Force | Out-Null
    }

    $geminiDir = ".gemini/agents"
    if (-not (Test-Path $geminiDir)) {
        New-Item -ItemType Directory -Path $geminiDir -Force | Out-Null
    }

    $copilotDir = ".github/agents"
    if (-not (Test-Path $copilotDir)) {
        New-Item -ItemType Directory -Path $copilotDir -Force | Out-Null
    }
}

# Helper: Sync agent definition to Antigravity CLI (.gemini/agents/)
function Sync-AntigravityAgent {
    param(
        [string]$AgentName,
        [string]$Content
    )

    $targetPath = ".gemini/agents/$AgentName.md"

    try {
        [System.IO.File]::WriteAllText($targetPath, $Content, [System.Text.UTF8Encoding]::new($false))
        Write-Status "Synced to Antigravity: $targetPath" "SUCCESS"
    }
    catch {
        Write-Status "ERROR: Failed to write $targetPath : $($_.Exception.Message)" "ERROR"
    }
}

# Helper: Sync agent definition to Claude Code (.claude/agents/)
function Sync-ClaudeCodeAgent {
    param(
        [string]$AgentName,
        [string]$Content
    )

    $targetPath = ".claude/agents/$AgentName.md"

    try {
        [System.IO.File]::WriteAllText($targetPath, $Content, [System.Text.UTF8Encoding]::new($false))
        Write-Status "Synced to Claude Code: $targetPath" "SUCCESS"
    }
    catch {
        Write-Status "ERROR: Failed to write $targetPath : $($_.Exception.Message)" "ERROR"
    }
}

# Helper: Sync agent definition to Copilot CLI (.github/agents/)
function Sync-CopilotAgent {
    param(
        [string]$AgentName,
        [string]$Content
    )

    $targetPath = ".github/agents/$AgentName.md"

    try {
        [System.IO.File]::WriteAllText($targetPath, $Content, [System.Text.UTF8Encoding]::new($false))
        Write-Status "Synced to Copilot: $targetPath" "SUCCESS"
    }
    catch {
        Write-Status "ERROR: Failed to write $targetPath : $($_.Exception.Message)" "ERROR"
    }
}

# Main sync logic
Initialize-LogDirectory
Write-Status "Starting agent definition sync..." "INFO"

$agents = @("jarvis", "friday", "nat", "sam", "wanda", "threepio", "ultron", "astra", "pym", "leo")

foreach ($agent in $agents) {
    Write-Status "Syncing agent: $agent" "INFO"

    $content = Get-MasterAgentDefinition -AgentName $agent
    if (-not $content) {
        Write-Status "Skipping $agent (master definition missing)" "ERROR"
        continue
    }

    Sync-AntigravityAgent -AgentName $agent -Content $content
    Sync-ClaudeCodeAgent -AgentName $agent -Content $content
    Sync-CopilotAgent -AgentName $agent -Content $content
}

# Verify sync integrity
$claudeCount = (Get-ChildItem -Path ".claude/agents" -Filter "*.md" -ErrorAction SilentlyContinue | Measure-Object).Count
$geminiCount = (Get-ChildItem -Path ".gemini/agents" -Filter "*.md" -ErrorAction SilentlyContinue | Measure-Object).Count
$copilotCount = (Get-ChildItem -Path ".github/agents" -Filter "*.md" -ErrorAction SilentlyContinue | Measure-Object).Count

$verificationPassed = $true
if ($claudeCount -eq 10 -and $geminiCount -eq 10 -and $copilotCount -eq 10) {
    Write-Status "Verification: All 10 agents synced to all 3 platforms (30/30 files)" "SUCCESS"

    # Byte-count spot-check for jarvis.md across platforms
    $masterPath = ".agents/agents/jarvis.md"
    $claudePath = ".claude/agents/jarvis.md"
    $geminiPath = ".gemini/agents/jarvis.md"
    $copilotPath = ".github/agents/jarvis.md"

    if ((Test-Path $masterPath) -and (Test-Path $claudePath) -and (Test-Path $geminiPath) -and (Test-Path $copilotPath)) {
        $masterSize = (Get-Item $masterPath).Length
        $claudeSize = (Get-Item $claudePath).Length
        $geminiSize = (Get-Item $geminiPath).Length
        $copilotSize = (Get-Item $copilotPath).Length

        if ($masterSize -eq $claudeSize -and $masterSize -eq $geminiSize -and $masterSize -eq $copilotSize) {
            Write-Status "Byte-count spot-check (jarvis.md): All platforms match ($masterSize bytes)" "SUCCESS"
        } else {
            Write-Status "ERROR: Byte-count mismatch for jarvis.md - Master: $masterSize, Claude: $claudeSize, Gemini: $geminiSize, Copilot: $copilotSize" "ERROR"
            $verificationPassed = $false
        }
    } else {
        Write-Status "ERROR: Spot-check files not found" "ERROR"
        $verificationPassed = $false
    }
} else {
    Write-Status "ERROR: Sync verification failed. Claude: $claudeCount, Gemini: $geminiCount, Copilot: $copilotCount" "ERROR"
    $verificationPassed = $false
}

if (-not $verificationPassed) {
    exit 1
}

Write-Status "Agent definition sync complete!" "SUCCESS"
Write-Status "Synced to: .gemini/agents/, .claude/agents/, .github/agents/" "INFO"
