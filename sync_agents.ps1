# Synchronize agent files from Claude (source) to Gemini and Copilot
# Usage: powershell.exe -File sync_agents.ps1

param(
    [switch]$Verbose
)

$sourceDir = "C:\Users\natha\.claude\agents"
$geminiDir = "C:\Users\natha\.gemini\agents"
$copilotDir = "C:\Users\natha\.copilot\agents"
$agentSystemDir = "C:\Users\natha\AgentSystem"

Write-Host "🔄 Synchronizing agent files..."
Write-Host "Source (Claude): $sourceDir"
Write-Host "Target (Gemini): $geminiDir"
Write-Host "Target (Copilot): $copilotDir"
Write-Host ""

# Copy agent files from Claude to Gemini and Copilot
$agentFiles = @(Get-ChildItem -Path $sourceDir -Name "*.md" | Where-Object { $_ -notmatch "AGENTS" })

$copiedCount = 0
foreach ($file in $agentFiles) {
    $sourcePath = Join-Path $sourceDir $file
    $geminiPath = Join-Path $geminiDir $file
    $copilotPath = Join-Path $copilotDir $file

    # Verify source exists and copy
    if (Test-Path $sourcePath) {
        Copy-Item -Path $sourcePath -Destination $geminiPath -Force | Out-Null
        Copy-Item -Path $sourcePath -Destination $copilotPath -Force | Out-Null
        $copiedCount++
    }
}

# Copy shared standards
$sharedSource = Join-Path $sourceDir "shared"
$sharedGemini = Join-Path $geminiDir "shared"
$sharedCopilot = Join-Path $copilotDir "shared"

if (Test-Path $sharedSource) {
    Copy-Item -Path "$sharedSource\*" -Destination $sharedGemini -Recurse -Force | Out-Null
    Copy-Item -Path "$sharedSource\*" -Destination $sharedCopilot -Recurse -Force | Out-Null
}

# Backup to AgentSystem
foreach ($cli in @("claude", "gemini", "copilot")) {
    $src = "C:\Users\natha\.$cli\agents"
    $dst = Join-Path $agentSystemDir $cli
    if (-not (Test-Path $dst)) { New-Item -ItemType Directory -Force -Path $dst | Out-Null }
    Copy-Item -Path "$src\*" -Destination $dst -Recurse -Force | Out-Null
}

Write-Host "✅ Synced $copiedCount agent files across all platforms"
