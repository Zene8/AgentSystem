#Requires -Version 5.1
<#
.SYNOPSIS
    Bootstrap any repo for the AgentSystem. Idempotent — safe to re-run.
.PARAMETER RepoPath
    Path to the repo to bootstrap. Defaults to current directory.
.PARAMETER Slug
    Short identifier for this repo (used as brain key). Defaults to dirname.
.PARAMETER PrimaryCli
    Which CLI to use as primary: claude, gemini, copilot. Defaults to claude.
.PARAMETER SkipGraphInit
    Skip running graph-init (useful if repo has no git history yet).
#>
param(
    [string]$RepoPath = (Get-Location).Path,
    [string]$Slug = "",
    [string]$PrimaryCli = "claude",
    [switch]$SkipGraphInit
)

$ErrorActionPreference = "Stop"
$RepoPath = Resolve-Path $RepoPath | Select-Object -ExpandProperty Path

if (-not $Slug) {
    $Slug = (Split-Path $RepoPath -Leaf) -replace '[^a-zA-Z0-9]', '-'
    $Slug = $Slug.ToLower()
}

$ScriptDir       = $PSScriptRoot
$RegistryPath    = if ($env:AGENT_MEMORY_ROOT) { Join-Path $env:AGENT_MEMORY_ROOT "nexus\known-repos.json" } else { Join-Path $env:USERPROFILE "agent-memory\nexus\known-repos.json" }
$TemplateFile    = Join-Path $ScriptDir "claude-md-block.txt"
$GraphInitScript = Join-Path $ScriptDir "graph\graph-init.js"
$ClaudeMdPath    = Join-Path $RepoPath "CLAUDE.md"

Write-Host "Bootstrap: $Slug @ $RepoPath" -ForegroundColor Cyan

# -- Step 1: Verify git repo --------------------------------------------------
if (-not (Test-Path (Join-Path $RepoPath ".git"))) {
    Write-Warning "Not a git repo: $RepoPath. Skipping git-dependent steps."
    $SkipGraphInit = $true
}

# -- Step 2: Detect project type + install deps -------------------------------
if (Test-Path (Join-Path $RepoPath "package.json")) {
    Write-Host "  Detected: Node.js -- running npm install" -ForegroundColor Gray
    Push-Location $RepoPath
    try { npm install --silent 2>$null } catch { Write-Warning "npm install failed (non-fatal)" }
    Pop-Location
}
if (Test-Path (Join-Path $RepoPath "requirements.txt")) {
    Write-Host "  Detected: Python -- running pip install" -ForegroundColor Gray
    try { pip install -r (Join-Path $RepoPath "requirements.txt") -q 2>$null } catch { Write-Warning "pip install failed (non-fatal)" }
}
if (Test-Path (Join-Path $RepoPath "go.mod")) {
    Write-Host "  Detected: Go -- running go mod download" -ForegroundColor Gray
    Push-Location $RepoPath
    try { go mod download 2>$null } catch { Write-Warning "go mod download failed (non-fatal)" }
    Pop-Location
}

# -- Step 3: Inject CLAUDE.md block (idempotent) ------------------------------
$BlockMarker = "AGENT-SYSTEM-BOOTSTRAP"
$AlreadyInjected = $false
if (Test-Path $ClaudeMdPath) {
    $existing = Get-Content $ClaudeMdPath -Raw -Encoding utf8
    if ($existing -match $BlockMarker) { $AlreadyInjected = $true }
}

if (-not $AlreadyInjected) {
    if (-not (Test-Path $TemplateFile)) {
        Write-Warning "Template file not found: $TemplateFile -- skipping CLAUDE.md injection"
    } else {
        $template = Get-Content $TemplateFile -Raw -Encoding utf8
        $block = $template -replace '\{\{SLUG\}\}', $Slug
        if (Test-Path $ClaudeMdPath) {
            Add-Content $ClaudeMdPath "`n$block" -Encoding utf8
        } else {
            Set-Content $ClaudeMdPath "# $Slug`n`n$block" -Encoding utf8
        }
        Write-Host "  Injected agent block into CLAUDE.md" -ForegroundColor Green
    }
} else {
    Write-Host "  CLAUDE.md already has agent block (skipped)" -ForegroundColor Gray
}

# -- Step 4: Run graph-init ---------------------------------------------------
if (-not $SkipGraphInit) {
    if (Test-Path $GraphInitScript) {
        Write-Host "  Running graph-init for: $Slug" -ForegroundColor Gray
        Push-Location $RepoPath
        try {
            $ErrorActionPreference = "Continue"
            $initOut = node $GraphInitScript $Slug $RepoPath 2>&1
            $ErrorActionPreference = "Stop"
            Write-Host "  $initOut" -ForegroundColor Gray
        } catch {
            $ErrorActionPreference = "Stop"
            Write-Warning "graph-init failed (non-fatal): $_"
        }
        Pop-Location
    } else {
        Write-Warning "graph-init.js not found at $GraphInitScript -- skipping"
    }
} else {
    Write-Host "  Skipping graph-init (SkipGraphInit flag)" -ForegroundColor Gray
}

# -- Step 5: Register in known-repos.json (pure PowerShell) ------------------
$regDir = Split-Path $RegistryPath -Parent
if (-not (Test-Path $regDir)) { New-Item -ItemType Directory -Force $regDir | Out-Null }

$registry = if (Test-Path $RegistryPath) {
    try { Get-Content $RegistryPath -Raw -Encoding utf8 | ConvertFrom-Json }
    catch { [PSCustomObject]@{ version = "1.0"; repos = @() } }
} else {
    [PSCustomObject]@{ version = "1.0"; repos = @() }
}

$repos = [System.Collections.Generic.List[object]]::new()
foreach ($r in $registry.repos) { $repos.Add($r) }

$existingIdx = -1
for ($i = 0; $i -lt $repos.Count; $i++) {
    if ($repos[$i].slug -eq $Slug) { $existingIdx = $i; break }
}

$record = [PSCustomObject]@{
    slug               = $Slug
    path               = $RepoPath -replace '\\', '/'
    brain_path         = "nexus/$Slug/graph.json"
    last_init          = (Get-Date -Format "yyyy-MM-dd")
    primary_cli        = $PrimaryCli
    bootstrap_complete = $true
}

if ($existingIdx -ge 0) { $repos[$existingIdx] = $record }
else { $repos.Add($record) }

$registry = [PSCustomObject]@{ version = "1.0"; repos = $repos.ToArray() }
$json = $registry | ConvertTo-Json -Depth 5
# Write UTF-8 without BOM (PS5.1 "utf8" writes BOM; use .NET directly)
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($RegistryPath, $json, $utf8NoBom)
Write-Host "  Registered: $Slug" -ForegroundColor Green

# -- Step 6: Verify CLIs ------------------------------------------------------
foreach ($cli in @("claude", "gemini", "copilot")) {
    $found = Get-Command $cli -ErrorAction SilentlyContinue
    if ($found) { Write-Host "  CLI: $cli found" -ForegroundColor Green }
    else { Write-Warning "  CLI: $cli not found (install for full agent support)" }
}

Write-Host ""
Write-Host "Bootstrap complete: $Slug" -ForegroundColor Cyan
Write-Host "  Repo:  $RepoPath"
Write-Host "  Brain: $RepoPath\nexus\$Slug\"
Write-Host "  Query: node tools/graph/graph-query.js $Slug <keywords>"
