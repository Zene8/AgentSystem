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
    Add-Content -Path $LogFile -Value $output
}

# Helper: Get master agent definition file content
function Get-MasterAgentDefinition {
    param([string]$AgentName)

    $mastePath = ".agents/agents/$AgentName.md"

    if (-not (Test-Path $mastePath)) {
        Write-Status "ERROR: Master definition not found: $mastePath" "ERROR"
        return $null
    }

    Get-Content -Path $mastePath -Raw
}

# Helper: Sync agent definition to Antigravity CLI (.gemini/agents/)
function Sync-AntigravityAgent {
    param(
        [string]$AgentName,
        [string]$Content
    )

    $geminiDir = ".gemini/agents"
    if (-not (Test-Path $geminiDir)) {
        New-Item -ItemType Directory -Path $geminiDir -Force | Out-Null
        Write-Status "Created directory: $geminiDir" "INFO"
    }

    $targetPath = "$geminiDir/$AgentName.md"
    Set-Content -Path $targetPath -Value $Content -Force
    Write-Status "Synced to Antigravity: $targetPath" "SUCCESS"
}

# Helper: Sync agent definition to Claude Code (.claude/agents/)
function Sync-ClaudeCodeAgent {
    param(
        [string]$AgentName,
        [string]$Content
    )

    $claudeDir = ".claude/agents"
    if (-not (Test-Path $claudeDir)) {
        New-Item -ItemType Directory -Path $claudeDir -Force | Out-Null
        Write-Status "Created directory: $claudeDir" "INFO"
    }

    $targetPath = "$claudeDir/$AgentName.md"
    Set-Content -Path $targetPath -Value $Content -Force
    Write-Status "Synced to Claude Code: $targetPath" "SUCCESS"
}

# Helper: Sync agent definition to Copilot CLI (.github/agents/)
function Sync-CopilotAgent {
    param(
        [string]$AgentName,
        [string]$Content
    )

    $copilotDir = ".github/agents"
    if (-not (Test-Path $copilotDir)) {
        New-Item -ItemType Directory -Path $copilotDir -Force | Out-Null
        Write-Status "Created directory: $copilotDir" "INFO"
    }

    $targetPath = "$copilotDir/$AgentName.md"
    Set-Content -Path $targetPath -Value $Content -Force
    Write-Status "Synced to Copilot: $targetPath" "SUCCESS"
}

# Main sync logic
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

Write-Status "Agent definition sync complete!" "SUCCESS"
Write-Status "Synced to: .gemini/agents/, .claude/agents/, .github/agents/" "INFO"
