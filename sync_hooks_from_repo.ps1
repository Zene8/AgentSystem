# sync_hooks_from_repo.ps1 - Copy repo hooks/ -> ~/.claude/hooks/ and merge hook entries
# into ~/.claude/settings.json idempotently.
#
# Manages both memory hooks (JS) and shell script hooks (SH) under ~/.claude/hooks/.
#
# Run after any change to hooks/ or settings.json hooks.

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

$jsHookFiles = @("memory-context-inject.js", "memory-context-inject-subagent.js", "memory-router.js", "memory-capture-hook.js", "sona-writeback-hook.js", "injection-feedback-hook.js", "routine-dispatch.js", "routines-context-inject.js", "tool-output-compress.js", "routing-config.js")
$shHookFiles = @("session-start.sh", "session-end.sh", "user-prompt-submit.sh", "guard-git.sh", "wip-checkpoint.sh", "session-close.sh", "context-handoff.sh")
$copyFailed = $false

# Copy JS hook files (and rewrite tools path resolved relative to repo)
foreach ($file in $jsHookFiles) {
    $src  = Join-Path $hooksDir $file
    $dest = Join-Path $claudeHooks $file

    if (-not (Test-Path $src)) {
        Write-Status "ERROR: Source hook not found: $src" "ERROR"
        $copyFailed = $true
        continue
    }

    $srcText = [System.IO.File]::ReadAllText($src, [System.Text.UTF8Encoding]::new($false))
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
    Write-Status "Synced JS hook: $file -> $dest" "SUCCESS"
}

# Copy SH hook files (and rewrite repo root paths dynamically)
$shHooksSrcDir = Join-Path $hooksDir "claude-hooks"
foreach ($file in $shHookFiles) {
    $src  = Join-Path $shHooksSrcDir $file
    $dest = Join-Path $claudeHooks $file

    if (-not (Test-Path $src)) {
        Write-Status "ERROR: Source hook not found: $src" "ERROR"
        $copyFailed = $true
        continue
    }

    $srcText = [System.IO.File]::ReadAllText($src, [System.Text.UTF8Encoding]::new($false))
    $repoRootBash = $RepoRoot -replace '\\', '/'
    $deployText = $srcText -replace '~/dev/AgentSystem', $repoRootBash

    $expectedHash = Get-StringHash -Text $deployText
    if (Test-Path $dest) {
        $destText = [System.IO.File]::ReadAllText($dest, [System.Text.UTF8Encoding]::new($false))
        if ((Get-StringHash -Text $destText) -eq $expectedHash) {
            Write-Status "Skipped (unchanged): $file" "INFO"
            continue
        }
    }

    [System.IO.File]::WriteAllText($dest, $deployText, [System.Text.UTF8Encoding]::new($false))
    Write-Status "Synced SH hook: $file -> $dest" "SUCCESS"
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
        event         = 'SessionStart'
        type          = 'command'
        command       = "node `"$claudeHooksNorm/routines-context-inject.js`""
        timeout       = 5
        statusMessage = 'Loading enforced routines...'
    },
    [PSCustomObject]@{
        event         = 'SessionStart'
        type          = 'command'
        command       = "bash `"$claudeHooksNorm/session-start.sh`""
        timeout       = 10
        statusMessage = 'Starting session...'
    },
    [PSCustomObject]@{
        event         = 'UserPromptSubmit'
        type          = 'command'
        command       = "node `"$claudeHooksNorm/memory-router.js`""
        timeout       = 5
        statusMessage = 'Routing...'
    },
    # 2026-07-12 audit: routine-dispatch.js dropped from UserPromptSubmit — its only prompt-stage
    # behavior (identity-query hint) duplicated memory-router.js. It stays on PostToolUse.
    [PSCustomObject]@{
        event         = 'UserPromptSubmit'
        type          = 'command'
        command       = "bash `"$claudeHooksNorm/user-prompt-submit.sh`""
        timeout       = 5
        statusMessage = 'Registering prompt...'
    },
    [PSCustomObject]@{
        event         = 'SessionEnd'
        type          = 'command'
        command       = "node `"$claudeHooksNorm/memory-capture-hook.js`""
        timeout       = 5
        statusMessage = 'Capturing memory...'
    },
    [PSCustomObject]@{
        event         = 'SessionEnd'
        type          = 'command'
        command       = "bash `"$claudeHooksNorm/session-close.sh`""
        timeout       = 10
        statusMessage = 'Finalizing session...'
    },
    # 2026-07-12 audit: routine-dispatch.js dropped from the Write|Edit|NotebookEdit matcher —
    # its PostToolUse logic only inspects Bash payloads (gh pr create detection), so the
    # Write|Edit registration was a pure no-op process spawn on every file edit.
    [PSCustomObject]@{
        event         = 'PostToolUse'
        type          = 'command'
        command       = "bash `"$claudeHooksNorm/wip-checkpoint.sh`""
        timeout       = 5
        statusMessage = 'Saving checkpoint...'
        matcher       = 'Write|Edit|NotebookEdit'
    },
    [PSCustomObject]@{
        # #154: routine-dispatch.js already parses Bash PostToolUse payloads to detect
        # `gh pr create` and schedule the auto-resolve-pr-comments routine (see
        # hooks/routine-dispatch.js), but it was only ever wired up on the
        # Write|Edit|NotebookEdit matcher above, so it never received Bash tool events and the
        # auto-resolve-pr-comments routine was effectively dead. This entry gives it a second
        # registration on the Bash matcher so both trigger paths are covered.
        event         = 'PostToolUse'
        type          = 'command'
        command       = "node `"$claudeHooksNorm/routine-dispatch.js`""
        timeout       = 5
        statusMessage = 'Checking routines (Bash)...'
        matcher       = 'Bash'
    },
    [PSCustomObject]@{
        # 2026-07-12 audit: this hook only fires on outputs >5000 chars, which in practice
        # come from Bash — the old Write|Edit registration meant it never triggered on
        # anything meaningful. Scope it to Bash explicitly.
        event         = 'PostToolUse'
        type          = 'command'
        command       = "node `"$claudeHooksNorm/tool-output-compress.js`""
        timeout       = 5
        statusMessage = 'Compressing output...'
        matcher       = 'Bash'
    },
    [PSCustomObject]@{
        event         = 'PreToolUse'
        type          = 'command'
        command       = "bash `"$claudeHooksNorm/guard-git.sh`""
        timeout       = 5
        statusMessage = 'Guarding git...'
        matcher       = 'Bash'
    },
    [PSCustomObject]@{
        event         = 'Stop'
        type          = 'command'
        command       = "node `"$claudeHooksNorm/sona-writeback-hook.js`""
        timeout       = 5
        statusMessage = 'Writing episodic memory...'
    },
    [PSCustomObject]@{
        # Memory feedback loop: scores injected memory nodes against the finished transcript and
        # reinforces the ones actually used (hooks/injection-feedback-hook.js).
        event         = 'Stop'
        type          = 'command'
        command       = "node `"$claudeHooksNorm/injection-feedback-hook.js`""
        timeout       = 5
        statusMessage = 'Scoring memory usefulness...'
    },
    [PSCustomObject]@{
        event         = 'Stop'
        type          = 'command'
        command       = "bash `"$claudeHooksNorm/session-end.sh`""
        timeout       = 5
        statusMessage = 'Ending session...'
    },
    [PSCustomObject]@{
        # 2026-07-12 audit: was registered in live settings.json but missing from this sync
        # script's manifest, so repo updates to the subagent memory hook never deployed.
        event         = 'SubagentStart'
        type          = 'command'
        command       = "node `"$claudeHooksNorm/memory-context-inject-subagent.js`""
        timeout       = 3
        statusMessage = 'Injecting subagent memory...'
    },
    [PSCustomObject]@{
        event         = 'SubagentStop'
        type          = 'command'
        command       = "node `"$claudeHooksNorm/sona-writeback-hook.js`""
        timeout       = 5
        statusMessage = 'Writing episodic memory...'
    },
    [PSCustomObject]@{
        event         = 'PreCompact'
        type          = 'command'
        command       = "bash `"$claudeHooksNorm/context-handoff.sh`""
        timeout       = 5
        statusMessage = 'Generating handoff doc...'
    }
)

$pendingMerges = [System.Collections.Generic.List[string]]::new()

# Ensure autoCompact settings are configured
if ($null -eq $settings.autoCompactEnabled -or $settings.autoCompactEnabled -ne $true) {
    $settings | Add-Member -MemberType NoteProperty -Name 'autoCompactEnabled' -Value $true -Force -ErrorAction SilentlyContinue
    $settings.autoCompactEnabled = $true
    $pendingMerges.Add("autoCompactEnabled -> true")
}
if ($null -eq $settings.autoCompactWindow -or $settings.autoCompactWindow -ne 150000) {
    $settings | Add-Member -MemberType NoteProperty -Name 'autoCompactWindow' -Value 150000 -Force -ErrorAction SilentlyContinue
    $settings.autoCompactWindow = 150000
    $pendingMerges.Add("autoCompactWindow -> 150000")
}

foreach ($entry in $injectEntries) {
    $event   = $entry.event
    $command = $entry.command
    $matcher = $entry.matcher

    $eventGroups = $settings.hooks.$event
    if ($null -eq $eventGroups) {
        $settings.hooks | Add-Member -MemberType NoteProperty -Name $event -Value @() -Force
        $eventGroups = $settings.hooks.$event
    }

    if ($eventGroups -isnot [System.Array]) { $eventGroups = @($eventGroups) }
    
    # Find group with matching matcher
    $group = $null
    foreach ($g in $eventGroups) {
        if ($null -ne $matcher) {
            if ($g.matcher -eq $matcher) {
                $group = $g
                break
            }
        } else {
            if ($null -eq $g.matcher) {
                $group = $g
                break
            }
        }
    }

    # If no group matches, add a new one
    if ($null -eq $group) {
        if ($null -ne $matcher) {
            $group = [PSCustomObject]@{ matcher = $matcher; hooks = @() }
        } else {
            $group = [PSCustomObject]@{ hooks = @() }
        }
        $eventGroups = $eventGroups + @($group)
        $settings.hooks.$event = $eventGroups
    }

    $existingCmds = @()
    if ($null -ne $group.hooks) {
        $existingCmds = @($group.hooks | ForEach-Object { if ($_ -and $_.command) { $_.command } })
    }

    # Normalize command quotes/slashes comparison to be idempotent across slight format changes
    $normCommand = $command -replace "'", '"' -replace '\\', '/'
    $alreadyPresent = $false
    foreach ($c in $existingCmds) {
        $normC = $c -replace "'", '"' -replace '\\', '/'
        if ($normC -eq $normCommand) {
            $alreadyPresent = $true
            break
        }
    }

    if ($alreadyPresent) {
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
