# sync_hooks_from_repo.ps1 - Copy repo hooks/ -> ~/.claude/hooks/ and merge hook entries
# into ~/.claude/settings.json idempotently.
#
# Only manages the two memory hooks. Other hooks (caveman-*, agent-context-inject, etc.)
# are out of scope -- they live in ~/.claude/hooks/ and are not repo-owned.
#
# Run after any change to hooks/memory-context-inject.js or hooks/memory-router.js.

param(
    [string]$LogFile = ".agents/sync.log",
    [string]$RepoRoot = $PSScriptRoot
)

# Resolve user home. Try multiple sources in order.
$UserHome = $null
foreach ($candidate in @(
    $env:USERPROFILE,
    $env:HOME,
    $(if ($env:HOMEDRIVE -and $env:HOMEPATH) { Join-Path $env:HOMEDRIVE $env:HOMEPATH } else { $null }),
    [System.Environment]::GetFolderPath('UserProfile'),
    (& { try { (Resolve-Path '~' -ErrorAction Stop).ProviderPath } catch { $null } })
)) {
    if (-not [string]::IsNullOrWhiteSpace($candidate)) { $UserHome = $candidate; break }
}
if ([string]::IsNullOrWhiteSpace($UserHome)) {
    Write-Error "Cannot determine user home directory. Set USERPROFILE and re-run."
    exit 1
}

function Write-Status {
    param([string]$Message, [ValidateSet("SUCCESS","ERROR","INFO","WARNING")][string]$Type = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $color = switch ($Type) { "SUCCESS" { "Green" } "ERROR" { "Red" } "WARNING" { "Yellow" } "INFO" { "Cyan" } }
    $output = "[$timestamp] [$Type] $Message"
    Write-Host $output -ForegroundColor $color
    Add-Content -Path $LogFile -Value $output -Encoding UTF8
}

function Get-StringHash {
    param([string]$Text)
    $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($Text)
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    $hashBytes = $sha256.ComputeHash($bytes)
    $sha256.Dispose()
    return ([BitConverter]::ToString($hashBytes) -replace '-', '').ToLower()
}

# Ensure log dir exists
$logDir = Split-Path -Path $LogFile
if ($logDir -and -not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

# --- Step 1: Copy hook files to ~/.claude/hooks/ ---

$hooksDir    = Join-Path $RepoRoot "hooks"
$claudeHooks = Join-Path $UserHome ".claude\hooks"

if (-not (Test-Path $claudeHooks)) {
    New-Item -ItemType Directory -Path $claudeHooks -Force | Out-Null
}

$hookFiles = @("memory-context-inject.js", "memory-router.js", "memory-capture-hook.js")
$copyFailed = $false

foreach ($file in $hookFiles) {
    $src  = Join-Path $hooksDir $file
    $dest = Join-Path $claudeHooks $file

    if (-not (Test-Path $src)) {
        Write-Status "ERROR: Source hook not found: $src" "ERROR"
        $copyFailed = $true
        continue
    }

    $srcText = [System.IO.File]::ReadAllText($src, [System.Text.UTF8Encoding]::new($false))

    # Resolve __dirname reference: replace relative path.resolve() with the repo's absolute tools path.
    # This makes the deployed hook work from ~/.claude/hooks/ which is not adjacent to tools/.
    $toolsAbsolute = (Join-Path $RepoRoot "tools") -replace '\\', '/'
    $deployText = $srcText -replace "path\.resolve\(__dirname, '\.\.', 'tools'\)", "'$toolsAbsolute'"

    $expectedHash = Get-StringHash -Text $deployText
    if (Test-Path $dest) {
        $destText = [System.IO.File]::ReadAllText($dest, [System.Text.UTF8Encoding]::new($false))
        if ((Get-StringHash -Text $destText) -eq $expectedHash) {
            Write-Status "Skipped (unchanged): $file" "INFO"
            continue
        }
    }

    [System.IO.File]::WriteAllText($dest, $deployText, [System.Text.UTF8Encoding]::new($false))
    $actualText = [System.IO.File]::ReadAllText($dest, [System.Text.UTF8Encoding]::new($false))
    if ((Get-StringHash -Text $actualText) -ne $expectedHash) {
        Write-Status "ERROR: Hash mismatch after writing $dest" "ERROR"
        $copyFailed = $true
        continue
    }
    Write-Status "Synced hook: $file -> $dest" "SUCCESS"
}

if ($copyFailed) {
    Write-Status "Hook file copy failed -- aborting settings.json merge" "ERROR"
    exit 1
}

# --- Step 2: Merge hook entries into ~/.claude/settings.json idempotently ---
# Idempotency key: the 'command' string. If already present, skip.
# Uses ConvertTo-Json -Depth 100 to avoid PS5.1 truncation of nested structures.

$settingsPath = Join-Path $UserHome ".claude\settings.json"

if ([string]::IsNullOrWhiteSpace($settingsPath) -or $settingsPath -eq "\.claude\settings.json") {
    Write-Status "Cannot resolve settings.json path (UserHome=$UserHome). Run via PowerShell tool." "ERROR"
    exit 1
}

if (-not (Test-Path $settingsPath)) {
    Write-Status "settings.json not found at $settingsPath -- skipping merge" "WARNING"
    exit 0
}

try {
    $settingsRaw = [System.IO.File]::ReadAllText($settingsPath, [System.Text.UTF8Encoding]::new($false))
} catch {
    Write-Status "ERROR: Cannot read settings.json at $settingsPath : $_" "ERROR"
    exit 1
}

$settings = $settingsRaw | ConvertFrom-Json
if ($null -eq $settings) {
    Write-Status "ERROR: settings.json could not be parsed" "ERROR"
    exit 1
}

Write-Status "settings.json loaded from $settingsPath (size=$($settingsRaw.Length))" "INFO"

$claudeHooksNorm = $claudeHooks -replace '\\', '/'
$injectEntries = @(
    [PSCustomObject]@{
        event         = 'SessionStart'
        type          = 'command'
        command       = "node `"$claudeHooksNorm/memory-context-inject.js`""
        timeout       = 10
        statusMessage = 'Loading memory context...'
    },
    [PSCustomObject]@{
        event         = 'UserPromptSubmit'
        type          = 'command'
        command       = "node `"$claudeHooksNorm/memory-router.js`""
        timeout       = 5
        statusMessage = 'Routing...'
    },
    [PSCustomObject]@{
        event         = 'SessionEnd'
        type          = 'command'
        command       = "node `"$claudeHooksNorm/memory-capture-hook.js`""
        timeout       = 5
        statusMessage = 'Capturing memory...'
    }
)

$pendingMerges = [System.Collections.Generic.List[string]]::new()

foreach ($entry in $injectEntries) {
    $event   = $entry.event
    $command = $entry.command

    $eventGroups = $settings.hooks.$event
    if ($null -eq $eventGroups) {
        $emptyGroup = [PSCustomObject]@{ hooks = @() }
        $settings.hooks | Add-Member -MemberType NoteProperty -Name $event -Value @($emptyGroup) -Force
        $eventGroups = $settings.hooks.$event
    }

    if ($eventGroups -isnot [System.Array]) { $eventGroups = @($eventGroups) }
    $group = $eventGroups[0]

    $existingCmds = @()
    if ($null -ne $group.hooks) {
        $existingCmds = @($group.hooks | ForEach-Object { if ($_ -and $_.command) { $_.command } })
    }

    if ($existingCmds -contains $command) {
        Write-Status "Already present (idempotent): $event -> $command" "INFO"
        continue
    }

    $newHook = [PSCustomObject]@{
        type          = $entry.type
        command       = $command
        timeout       = $entry.timeout
        statusMessage = $entry.statusMessage
    }

    if ($null -eq $group.hooks) {
        $group | Add-Member -MemberType NoteProperty -Name 'hooks' -Value @($newHook) -Force
    } else {
        $group.hooks = @($group.hooks) + @($newHook)
    }

    $pendingMerges.Add("$event -> $command")
}

if ($pendingMerges.Count -gt 0) {
    $newJson = $settings | ConvertTo-Json -Depth 100
    try {
        [System.IO.File]::WriteAllText($settingsPath, $newJson, [System.Text.UTF8Encoding]::new($false))
    } catch {
        Write-Status "ERROR: Cannot write settings.json: $_" "ERROR"
        exit 1
    }
    foreach ($m in $pendingMerges) { Write-Status "Merged hook: $m" "SUCCESS" }
    $addedCount = $pendingMerges.Count
    Write-Status "settings.json written: $addedCount entries added" "SUCCESS"
} else {
    Write-Status "settings.json unchanged (all entries already present)" "INFO"
}

Write-Status "Hook sync complete" "SUCCESS"
