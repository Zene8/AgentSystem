# sync_agents_from_repo.ps1 â€” Unified agent definition sync from master to all CLIs

param(
    [string]$LogFile = ".agents/sync.log"
)

# Helper: Write timestamped status to console and log file
function Write-Status {
    param(
        [string]$Message,
        [ValidateSet("SUCCESS", "ERROR", "INFO", "WARNING")]
        [string]$Type = "INFO"
    )

    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $color = switch ($Type) {
        "SUCCESS" { "Green" }
        "ERROR" { "Red" }
        "WARNING" { "Yellow" }
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

    # Validate name field is a non-empty slug
    if ($content -match '^name:\s*(.+)$') {
        $agentNameValue = $Matches[1].Trim()
        if ([string]::IsNullOrWhiteSpace($agentNameValue)) {
            Write-Status "ERROR: 'name:' field is empty in $mastePath â€” must be a non-empty slug" "ERROR"
            return $null
        }
    }

    # Validate behavior section has content beyond the block scalar indicator
    if ($content -match 'behavior:\s*\|') {
        $behaviorMatch = [regex]::Match($content, 'behavior:\s*\|\s*\n([\s\S]+?)(?=\n[a-z\-]+:|\z)')
        if (-not $behaviorMatch.Success -or [string]::IsNullOrWhiteSpace($behaviorMatch.Groups[1].Value)) {
            Write-Status "ERROR: 'behavior:' section is empty in $mastePath â€” agent body required" "ERROR"
            return $null
        }
    }

    return $content
}

# Helper: Compute SHA256 hash of a UTF-8 string (no BOM)
function Get-StringHash {
    param([string]$Text)
    $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($Text)
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    $hashBytes = $sha256.ComputeHash($bytes)
    $sha256.Dispose()
    return ([BitConverter]::ToString($hashBytes) -replace '-', '').ToLower()
}

# Helper: Initialize log directory only (agent directories created by sync functions)
function Initialize-LogDirectory {
    $logDir = Split-Path -Path $LogFile
    if (-not $logDir) { $logDir = ".agents" }
    if ($logDir -and -not (Test-Path $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }
}

# Helper: Map Claude model names to Gemini equivalents
function Get-GeminiModel {
    param(
        [string]$ClaudeModel,
        [string]$AgentName
    )

    # Tier 3 (complex reasoning): gemini-3.1-pro-preview
    # Tier 2 (standard work):    gemini-3-flash-preview
    # Tier 1 (simple/fast):      gemini-3.1-flash-lite-preview
    switch ($AgentName.ToLower()) {
        'jarvis'   { return 'gemini-3.1-pro-preview' }
        'sam'      { return 'gemini-3.1-pro-preview' }
        'friday'   { return 'gemini-3-flash-preview' }
        'nat'      { return 'gemini-3-flash-preview' }
        'ultron'   { return 'gemini-3-flash-preview' }
        'pym'      { return 'gemini-3-flash-preview' }
        'leo'      { return 'gemini-3-flash-preview' }
        'astra'    { return 'gemini-3-flash-preview' }
        'wanda'    { return 'gemini-3.1-flash-lite-preview' }
        'threepio' { return 'gemini-3.1-flash-lite-preview' }
        'r2d2'     { return 'gemini-3.1-flash-lite-preview' }
        default    { return 'gemini-3-flash-preview' }
    }
}

# Helper: Map Claude model names to Copilot equivalents
function Get-CopilotModel {
    param([string]$ClaudeModel)

    $mapping = @{
        "claude-opus-4-7" = "gpt-5.2-codex"
        "claude-sonnet-4-6" = "gpt-5.2-codex"
        "claude-haiku-4-5-20251001" = "gpt-5.4-mini"
    }

    if ($mapping.ContainsKey($ClaudeModel)) {
        return $mapping[$ClaudeModel]
    }
    return "gpt-5.4-mini"
}

# Helper: Extract name, model, and description from Markdown agent definition
function Get-AgentMetadata {
    param([string]$Content)

    $metadata = @{
        name = $null
        model = $null
        description = $null
    }

    $lines = $Content -split "`n"
    foreach ($line in $lines) {
        if ($line -match '^name:\s*(.+)$') {
            $metadata.name = $matches[1].Trim()
        }
        elseif ($line -match '^model:\s*(.+)$') {
            $metadata.model = $matches[1].Trim()
        }
        elseif ($line -match '^description:\s*(.+)$') {
            $metadata.description = $matches[1].Trim()
        }
    }

    return $metadata
}

# Helper: Prepend YAML frontmatter for Claude Code format
function Add-ClaudeYamlFrontmatter {
    param(
        [string]$AgentName,
        [string]$Content
    )

    # Extract top-level metadata and a cleaned body for Claude frontmatter
    $metadata = Get-AgentMetadata -Content $Content
    $name = if ($metadata.name) { $metadata.name } else { $AgentName }
    $description = if ($metadata.description) { $metadata.description } else { "" }
    $model = if ($metadata.model) { $metadata.model } else { "claude-sonnet-4-6" }

    # Build YAML header
    $yaml = @"
---
name: "$name"
description: "$description"
model: $model
memory: user
---

"@

    # Strip metadata key:value lines from the original content so the body only
    # contains the agent prompt/instructions (Claude expects frontmatter + body)
    $body = Strip-MetadataFromContent -Content $Content

    return $yaml + $body
}

# Helper: Prepend YAML frontmatter for GitHub Copilot format
function Add-CopilotYamlFrontmatter {
    param(
        [string]$AgentName,
        [string]$Content
    )

    # Extract metadata and produce a clean body for Copilot frontmatter
    $metadata = Get-AgentMetadata -Content $Content
    $name = if ($metadata.name) { $metadata.name } else { $AgentName }
    $description = if ($metadata.description) { $metadata.description } else { "" }

    # Tier 3 (complex reasoning): gpt-5.2-codex
    # Tier 2 (standard work):    gpt-5-mini
    # Tier 1 (cheapest):         gpt-5-mini   (gpt-5-mini << gpt-5.4-mini in cost)
    # Tier 2 (standard):         gpt-5.4-mini
    switch ($AgentName.ToLower()) {
        'jarvis'   { $copilotModel = 'gpt-5.2-codex' }
        'sam'      { $copilotModel = 'gpt-5.2-codex' }
        'friday'   { $copilotModel = 'gpt-5.4-mini' }
        'nat'      { $copilotModel = 'gpt-5.4-mini' }
        'ultron'   { $copilotModel = 'gpt-5.4-mini' }
        'pym'      { $copilotModel = 'gpt-5.4-mini' }
        'leo'      { $copilotModel = 'gpt-5.4-mini' }
        'astra'    { $copilotModel = 'gpt-5.4-mini' }
        'wanda'    { $copilotModel = 'gpt-5-mini' }
        'threepio' { $copilotModel = 'gpt-5-mini' }
        'r2d2'     { $copilotModel = 'gpt-5-mini' }
        default    { $copilotModel = 'gpt-5.4-mini' }
    }

    $yaml = @"
---
name: "$name"
description: "$description"
model: "$copilotModel"
---

"@

    $body = Strip-MetadataFromContent -Content $Content

    return $yaml + $body
}


# Helper: Remove top-level metadata key:value lines from a master agent file and return the remaining body.
function Strip-MetadataFromContent {
    param([string]$Content)

    $lines = $Content -split "`r?`n"
    $bodyLines = @()
    $inMetadata = $true

    foreach ($line in $lines) {
        if ($inMetadata -and $line -match '^[a-z\-]+:\s*(.*)$') {
            # still in metadata header, skip
            continue
        }

        # If we hit an empty line that's immediately after metadata, skip it
        if ($inMetadata -and $line.Trim() -eq "") {
            $inMetadata = $false
            continue
        }

        $inMetadata = $false
        $bodyLines += $line
    }

    return ($bodyLines -join "`n").Trim()
}

# Helper: Process multiline YAML block strings correctly
function Process-FieldContent {
    param([string[]]$Content)

    if ($Content.Count -eq 0) { return "" }
    
    # Check if first line is the block scalar indicator '|'
    $startIndex = 0
    if ($Content[0].Trim() -eq "|") {
        $startIndex = 1
    }

    $processedLines = @()
    for ($i = $startIndex; $i -lt $Content.Count; $i++) {
        $line = $Content[$i]
        # Strip leading two spaces if present
        if ($line -match '^  (.*)$') {
            $processedLines += $matches[1]
        } else {
            $processedLines += $line.Trim()
        }
    }

    return ($processedLines -join "`n").Trim()
}

# Helper: Convert Markdown agent definition to JSON format for Antigravity, mapping Claude models to Gemini
function ConvertTo-AgentJson {
    param([string]$Content)

    $lines = $Content -split "`r?\n"
    $agent = @{}
    $currentField = $null
    $fieldContent = @()

    foreach ($line in $lines) {
        if ($line -match '^([a-z\-]+):\s*(.*)$') {
            if ($currentField) {
                $agent[$currentField] = Process-FieldContent -Content $fieldContent
            }
            $currentField = $matches[1]
            $fieldContent = @()
            $val = $matches[2].Trim()
            if ($val) {
                $fieldContent += $val
            }
        }
        elseif ($currentField -and $line.Trim()) {
            $fieldContent += $line
        }
    }

    if ($currentField) {
        $agent[$currentField] = Process-FieldContent -Content $fieldContent
    }

    # Map Claude model to Gemini equivalent
    if ($agent["model"]) {
        $agentNameForJson = if ($agent["name"]) { $agent["name"] } else { $null }
        $agent["model"] = Get-GeminiModel -ClaudeModel $agent["model"] -AgentName $agentNameForJson
    }

    return $agent | ConvertTo-Json -Depth 10
}

# Helper: Initialize Antigravity agent root
function Initialize-AntigravityAgentRoot {
    $agentRootDir = "$env:USERPROFILE\.gemini\antigravity-cli\agent"
    
    if (-not (Test-Path $agentRootDir)) {
        New-Item -ItemType Directory -Path $agentRootDir -Force | Out-Null
    }
}

# Helper: Sync agent definition to Antigravity CLI as a plugin component
function Sync-AntigravityAgent {
    param(
        [string]$AgentName,
        [string]$Content,
        [ref]$SyncFailed
    )

    $targetDir = "$env:USERPROFILE\.gemini\antigravity-cli\agent\$AgentName"
    $targetPath = "$targetDir\agent.json"

    try {
        if (-not (Test-Path $targetDir)) {
            New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
        }

        # Convert Markdown to JSON
        $jsonContent = ConvertTo-AgentJson -Content $Content

        # Dirty-check: skip write if destination already matches
        $expectedHash = Get-StringHash -Text $jsonContent
        if ((Test-Path $targetPath) -and ((Get-FileHash -Path $targetPath -Algorithm SHA256).Hash.ToLower() -eq $expectedHash)) {
            Write-Status "Skipped (unchanged): $targetPath" "INFO"
            return
        }

        # Write JSON file
        [System.IO.File]::WriteAllText($targetPath, $jsonContent, [System.Text.UTF8Encoding]::new($false))

        # Verify file was actually written with correct content
        if (-not (Test-Path $targetPath)) {
            Write-Status "ERROR: File not found after write: $targetPath" "ERROR"
            $SyncFailed.Value = $true
            return
        }

        $actualHash = (Get-FileHash -Path $targetPath -Algorithm SHA256).Hash.ToLower()
        if ($actualHash -ne $expectedHash) {
            Write-Status "ERROR: Content hash mismatch after write for $targetPath (expected $expectedHash, got $actualHash)" "ERROR"
            $SyncFailed.Value = $true
            return
        }

        Write-Status "Synced to Antigravity: $targetPath" "SUCCESS"
    }
    catch {
        Write-Status "ERROR: Failed to write $targetPath : $($_.Exception.Message)" "ERROR"
        $SyncFailed.Value = $true
    }
}


# Helper: Prepend YAML frontmatter for Gemini CLI (user-level markdown)
function Add-GeminiYamlFrontmatter {
    param(
        [string]$AgentName,
        [string]$Content
    )

    $metadata = Get-AgentMetadata -Content $Content
    # Gemini requires a slug-style name (lowercase, hyphens). Use repository agent key.
    $rawName = $AgentName
    $name = ($rawName -replace '[^a-z0-9-]', '-') -replace '--+', '-' -replace '^-|-$',''
    $name = $name.ToLower()
    $description = if ($metadata.description) { $metadata.description } else { "" }

    # Determine Gemini model by agent role
    switch ($AgentName.ToLower()) {
        'jarvis'   { $geminiModel = 'gemini-3.1-pro-preview' }
        'sam'      { $geminiModel = 'gemini-3.1-pro-preview' }
        'friday'   { $geminiModel = 'gemini-3-flash-preview' }
        'nat'      { $geminiModel = 'gemini-3-flash-preview' }
        'ultron'   { $geminiModel = 'gemini-3-flash-preview' }
        'pym'      { $geminiModel = 'gemini-3-flash-preview' }
        'leo'      { $geminiModel = 'gemini-3-flash-preview' }
        'astra'    { $geminiModel = 'gemini-3-flash-preview' }
        'wanda'    { $geminiModel = 'gemini-3.1-flash-lite-preview' }
        'threepio' { $geminiModel = 'gemini-3.1-flash-lite-preview' }
        'r2d2'     { $geminiModel = 'gemini-3.1-flash-lite-preview' }
        default    { $geminiModel = 'gemini-3-flash-preview' }
    }

    $yaml = @"
---
name: "$name"
description: "$description"
model: "$geminiModel"
---

"@

    $body = Strip-MetadataFromContent -Content $Content

    return $yaml + $body
}


# Helper: Sync agent definition to user-level Gemini CLI as Markdown
function Sync-GeminiAgent {
    param(
        [string]$AgentName,
        [string]$Content,
        [ref]$SyncFailed
    )

    $targetDir = "$env:USERPROFILE\.gemini\agents"
    $targetPath = "$targetDir\$AgentName.md"

    try {
        if (-not (Test-Path $targetDir)) {
            New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
        }

        $contentWithFrontmatter = Add-GeminiYamlFrontmatter -AgentName $AgentName -Content $Content

        # Dirty-check: skip write if destination already matches
        $expectedHash = Get-StringHash -Text $contentWithFrontmatter
        if ((Test-Path $targetPath) -and ((Get-FileHash -Path $targetPath -Algorithm SHA256).Hash.ToLower() -eq $expectedHash)) {
            Write-Status "Skipped (unchanged): $targetPath" "INFO"
            return
        }

        [System.IO.File]::WriteAllText($targetPath, $contentWithFrontmatter, [System.Text.UTF8Encoding]::new($false))

        if (-not (Test-Path $targetPath)) {
            Write-Status "ERROR: File not found after write: $targetPath" "ERROR"
            $SyncFailed.Value = $true
            return
        }

        $actualHash = (Get-FileHash -Path $targetPath -Algorithm SHA256).Hash.ToLower()
        if ($actualHash -ne $expectedHash) {
            Write-Status "ERROR: Content hash mismatch after write for $targetPath (expected $expectedHash, got $actualHash)" "ERROR"
            $SyncFailed.Value = $true
            return
        }

        Write-Status "Synced to Gemini: $targetPath" "SUCCESS"
    }
    catch {
        Write-Status "ERROR: Failed to write $targetPath : $($_.Exception.Message)" "ERROR"
        $SyncFailed.Value = $true
    }
}

# Helper: Sync agent definition to Claude Code (.claude/agents/ user-level)
function Sync-ClaudeCodeAgent {
    param(
        [string]$AgentName,
        [string]$Content,
        [ref]$SyncFailed
    )

    $targetDir = "$env:USERPROFILE\.claude\agents"
    $targetPath = "$targetDir\$AgentName.md"

    try {
        # Create directory if needed
        if (-not (Test-Path $targetDir)) {
            New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
        }

        # Add YAML frontmatter for Claude Code format
        $contentWithFrontmatter = Add-ClaudeYamlFrontmatter -AgentName $AgentName -Content $Content

        # Dirty-check: skip write if destination already matches
        $expectedHash = Get-StringHash -Text $contentWithFrontmatter
        if ((Test-Path $targetPath) -and ((Get-FileHash -Path $targetPath -Algorithm SHA256).Hash.ToLower() -eq $expectedHash)) {
            Write-Status "Skipped (unchanged): $targetPath" "INFO"
            return
        }

        [System.IO.File]::WriteAllText($targetPath, $contentWithFrontmatter, [System.Text.UTF8Encoding]::new($false))

        # Verify file was actually written with correct content
        if (-not (Test-Path $targetPath)) {
            Write-Status "ERROR: File not found after write: $targetPath" "ERROR"
            $SyncFailed.Value = $true
            return
        }

        $actualHash = (Get-FileHash -Path $targetPath -Algorithm SHA256).Hash.ToLower()
        if ($actualHash -ne $expectedHash) {
            Write-Status "ERROR: Content hash mismatch after write for $targetPath (expected $expectedHash, got $actualHash)" "ERROR"
            $SyncFailed.Value = $true
            return
        }

        Write-Status "Synced to Claude Code: $targetPath" "SUCCESS"
    }
    catch {
        Write-Status "ERROR: Failed to write $targetPath : $($_.Exception.Message)" "ERROR"
        $SyncFailed.Value = $true
    }
}

# Helper: Sync agent definition to Copilot CLI (.copilot/agents/ user-level)
function Sync-CopilotAgent {
    param(
        [string]$AgentName,
        [string]$Content,
        [ref]$SyncFailed
    )

    $targetDir = "$env:USERPROFILE\.copilot\agents"
    $targetPath = "$targetDir\$AgentName.md"

    try {
        # Create directory if needed
        if (-not (Test-Path $targetDir)) {
            New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
        }

        # Add YAML frontmatter for GitHub Copilot format
        $contentWithFrontmatter = Add-CopilotYamlFrontmatter -AgentName $AgentName -Content $Content

        # Dirty-check: skip write if destination already matches
        $expectedHash = Get-StringHash -Text $contentWithFrontmatter
        if ((Test-Path $targetPath) -and ((Get-FileHash -Path $targetPath -Algorithm SHA256).Hash.ToLower() -eq $expectedHash)) {
            Write-Status "Skipped (unchanged): $targetPath" "INFO"
            return
        }

        [System.IO.File]::WriteAllText($targetPath, $contentWithFrontmatter, [System.Text.UTF8Encoding]::new($false))

        # Verify file was actually written with correct content
        if (-not (Test-Path $targetPath)) {
            Write-Status "ERROR: File not found after write: $targetPath" "ERROR"
            $SyncFailed.Value = $true
            return
        }

        $actualHash = (Get-FileHash -Path $targetPath -Algorithm SHA256).Hash.ToLower()
        if ($actualHash -ne $expectedHash) {
            Write-Status "ERROR: Content hash mismatch after write for $targetPath (expected $expectedHash, got $actualHash)" "ERROR"
            $SyncFailed.Value = $true
            return
        }

        Write-Status "Synced to Copilot: $targetPath" "SUCCESS"
    }
    catch {
        Write-Status "ERROR: Failed to write $targetPath : $($_.Exception.Message)" "ERROR"
        $SyncFailed.Value = $true
    }
}

# Main sync logic
Initialize-LogDirectory
Initialize-AntigravityAgentRoot
Write-Status "Starting agent definition sync..." "INFO"

$agents = @("jarvis", "friday", "nat", "sam", "wanda", "threepio", "ultron", "astra", "pym", "leo", "r2d2")
$syncFailed = $false

foreach ($agent in $agents) {
    Write-Status "Syncing agent: $agent" "INFO"

    $content = Get-MasterAgentDefinition -AgentName $agent
    if (-not $content) {
        Write-Status "Skipping $agent (master definition missing)" "ERROR"
        $syncFailed = $true
        continue
    }

    # Debug: check metadata extraction
    $metadata = Get-AgentMetadata -Content $content
    Write-Status "DEBUG: $agent metadata - name: $($metadata.name), model: $($metadata.model), description: $($metadata.description)" "INFO"

    Sync-AntigravityAgent -AgentName $agent -Content $content -SyncFailed ([ref]$syncFailed)
    Sync-ClaudeCodeAgent -AgentName $agent -Content $content -SyncFailed ([ref]$syncFailed)
    Sync-CopilotAgent -AgentName $agent -Content $content -SyncFailed ([ref]$syncFailed)
    Sync-GeminiAgent -AgentName $agent -Content $content -SyncFailed ([ref]$syncFailed)
}

# Verify sync integrity (check user-level directories)
$claudeDir = "$env:USERPROFILE\.claude\agents"
$copilotDir = "$env:USERPROFILE\.copilot\agents"
$antigravityDir = "$env:USERPROFILE\.gemini\antigravity-cli\agent"
$geminiDir = "$env:USERPROFILE\.gemini\agents"

$claudeCount = 0
$copilotCount = 0
$antigravityCount = 0
$geminiCount = 0

foreach ($agent in $agents) {
    if (Test-Path "$claudeDir\$agent.md") { $claudeCount++ }
    if (Test-Path "$copilotDir\$agent.md") { $copilotCount++ }
    if (Test-Path "$antigravityDir\$agent\agent.json") { $antigravityCount++ }
    if (Test-Path "$geminiDir\$agent.md") { $geminiCount++ }
}

$expectedCount = $agents.Count
$verificationPassed = $true

if ($claudeCount -eq $expectedCount -and $copilotCount -eq $expectedCount -and $antigravityCount -eq $expectedCount -and $geminiCount -eq $expectedCount -and -not $syncFailed) {
    Write-Status "Verification: All $expectedCount agents synced to all platforms (Claude: $claudeCount, Copilot: $copilotCount, Gemini: $geminiCount, Antigravity: $antigravityCount)" "SUCCESS"

    # Content spot-check for jarvis.md across platforms
    $masterPath = ".agents/agents/jarvis.md"
    $claudePath = "$env:USERPROFILE\.claude\agents\jarvis.md"
    $copilotPath = "$env:USERPROFILE\.copilot\agents\jarvis.md"
    $antigravityPath = "$env:USERPROFILE\.gemini\antigravity-cli\agent\jarvis\agent.json"
    $geminiPath = "$env:USERPROFILE\.gemini\agents\jarvis.md"

    if ((Test-Path $masterPath) -and (Test-Path $claudePath) -and (Test-Path $copilotPath) -and (Test-Path $antigravityPath) -and (Test-Path $geminiPath)) {
        $claudeHash = (Get-FileHash -Path $claudePath -Algorithm SHA256).Hash.ToLower()
        $copilotHash = (Get-FileHash -Path $copilotPath -Algorithm SHA256).Hash.ToLower()
        $claudeSize = (Get-Item $claudePath).Length
        $copilotSize = (Get-Item $copilotPath).Length
        $antigravitySize = (Get-Item $antigravityPath).Length
        $geminiSize = (Get-Item $geminiPath).Length

        # Verify files exist and are non-empty (frontmatter/body transformations may change size)
        if ($claudeSize -gt 0 -and $copilotSize -gt 0 -and $antigravitySize -gt 0 -and $geminiSize -gt 0) {
            Write-Status "Spot-check (jarvis): Claude=$claudeHash Copilot=$copilotHash (sizes: Claude=$claudeSize, Copilot=$copilotSize, Gemini=$geminiSize, Antigravity=$antigravitySize)." "SUCCESS"
            # Claude and Copilot have different frontmatter (different model keys) so hashes legitimately differ;
            # warn only if they are unexpectedly identical (would indicate a frontmatter injection bug)
            if ($claudeHash -eq $copilotHash) {
                Write-Status "WARNING: Claude and Copilot hashes are identical for jarvis — frontmatter may not have been applied correctly" "WARNING"
            }
        } else {
            Write-Status "ERROR: Content verification failed for jarvis - Claude: $claudeSize bytes, Copilot: $copilotSize bytes, Antigravity: $antigravitySize bytes" "ERROR"
            $verificationPassed = $false
        }
    } else {
        Write-Status "ERROR: Spot-check files not found" "ERROR"
        $verificationPassed = $false
    }

    # Content spot-check for friday.md across platforms
    $masterPath = ".agents/agents/friday.md"
    $claudePath = "$env:USERPROFILE\.claude\agents\friday.md"
    $copilotPath = "$env:USERPROFILE\.copilot\agents\friday.md"
    $antigravityPath = "$env:USERPROFILE\.gemini\antigravity-cli\agent\friday\agent.json"
    $geminiPath = "$env:USERPROFILE\.gemini\agents\friday.md"

    if ((Test-Path $masterPath) -and (Test-Path $claudePath) -and (Test-Path $copilotPath) -and (Test-Path $antigravityPath) -and (Test-Path $geminiPath)) {
        $claudeHash = (Get-FileHash -Path $claudePath -Algorithm SHA256).Hash.ToLower()
        $copilotHash = (Get-FileHash -Path $copilotPath -Algorithm SHA256).Hash.ToLower()
        $claudeSize = (Get-Item $claudePath).Length
        $copilotSize = (Get-Item $copilotPath).Length
        $antigravitySize = (Get-Item $antigravityPath).Length
        $geminiSize = (Get-Item $geminiPath).Length

        # Verify files exist and are non-empty (frontmatter/body transformations may change size)
        if ($claudeSize -gt 0 -and $copilotSize -gt 0 -and $antigravitySize -gt 0 -and $geminiSize -gt 0) {
            Write-Status "Spot-check (friday): Claude=$claudeHash Copilot=$copilotHash (sizes: Claude=$claudeSize, Copilot=$copilotSize, Gemini=$geminiSize, Antigravity=$antigravitySize)." "SUCCESS"
            if ($claudeHash -eq $copilotHash) {
                Write-Status "WARNING: Claude and Copilot hashes are identical for friday — frontmatter may not have been applied correctly" "WARNING"
            }
        } else {
            Write-Status "ERROR: Content verification failed for friday - Claude: $claudeSize bytes, Copilot: $copilotSize bytes, Antigravity: $antigravitySize bytes, Gemini: $geminiSize bytes" "ERROR"
            $verificationPassed = $false
        }
    } else {
        Write-Status "ERROR: Spot-check files not found for friday.md" "ERROR"
        $verificationPassed = $false
    }
} else {
    Write-Status "ERROR: Sync verification failed. Expected $expectedCount agents per platform. Claude: $claudeCount, Copilot: $copilotCount, Antigravity: $antigravityCount. Sync failures detected: $syncFailed" "ERROR"
    $verificationPassed = $false
}

if (-not $verificationPassed) {
    exit 1
}

# Validate memory files exist for all agents
Write-Status 'Validating agent memory files' 'INFO'
$memoryDir = '.agents/memory'
$memoryWarnings = 0
foreach ($agent in $agents) {
    $memoryPath = "$memoryDir\$agent.md"
    if (-not (Test-Path $memoryPath)) {
        Write-Status "Memory file missing for agent: $agent" INFO
        $memoryWarnings++
    }
}
if ($memoryWarnings -eq 0) {
    Write-Status 'Memory validation complete' SUCCESS
} else {
    Write-Status "Memory validation: $memoryWarnings agents missing files" INFO
}

# Sync config files to ~/.claude/agents/config/ so agent-context-inject.js hook picks them up
$configSrcDir  = "config"
$configDestDir = "$env:USERPROFILE\.claude\agents\config"
if (Test-Path $configSrcDir) {
    if (-not (Test-Path $configDestDir)) {
        New-Item -ItemType Directory -Path $configDestDir -Force | Out-Null
    }
    foreach ($file in Get-ChildItem "$configSrcDir\*.yml" -ErrorAction SilentlyContinue) {
        $dest = "$configDestDir\$($file.Name)"
        $srcHash = (Get-FileHash -Path $file.FullName -Algorithm SHA256).Hash.ToLower()
        if ((Test-Path $dest) -and ((Get-FileHash -Path $dest -Algorithm SHA256).Hash.ToLower() -eq $srcHash)) {
            Write-Status "Skipped (unchanged): $($file.Name)" "INFO"
            continue
        }
        Copy-Item -Path $file.FullName -Destination $dest -Force
        Write-Status "Synced config: $($file.Name) -> $dest" "SUCCESS"
    }
}

Write-Status 'Agent definition sync complete' SUCCESS

