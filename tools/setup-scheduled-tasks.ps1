# setup-scheduled-tasks.ps1 — register Windows Task Scheduler jobs for AgentSystem memory maintenance.
# Replaces dead self-hosted GitHub Actions cron (scheduled-tasks.yml jobs that use `runs-on: self-hosted`).
#
# Tasks registered:
#   AgentSystem-WeeklyBrainConsolidation  — Monday 08:00, runs memory-maintenance.js --reflect
#   AgentSystem-WeeklyMemoryDecay         — Sunday  00:00, runs memory-decay.js for both brains
#
# Note: daily-standup and weekly-trust-scores are skipped:
#   - daily-standup: agent invocation via claude CLI requires an active session; cannot run headlessly.
#   - weekly-trust-scores: compute-trust-scores.js has a pre-existing ESM/CJS bug (uses require in ESM scope).
#
# Usage: Run once as the same user that runs AgentSystem (no admin required for CURRENT_USER tasks).
#   pwsh -File tools/setup-scheduled-tasks.ps1
# To remove all tasks: pwsh -File tools/setup-scheduled-tasks.ps1 -Uninstall

param([switch]$Uninstall)

$NodePath  = (Get-Command node -ErrorAction Stop).Source
$ToolsRoot = "C:\Users\natha\AgentSystem\tools"
$LogDir    = "C:\Users\natha\AgentSystem\logs"

if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Force $LogDir | Out-Null }

$tasks = @(
    @{
        Name        = 'AgentSystem-WeeklyBrainConsolidation'
        Description = 'Run full memory sleep cycle (split/reconsolidate/decay/stale-prune/consolidate/seed + reflection)'
        # Monday 08:00 local time
        Trigger     = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At '08:00'
        Script      = "$ToolsRoot\memory-maintenance.js"
        Args        = '--reflect'
        Log         = "$LogDir\brain-consolidation.log"
    },
    @{
        Name        = 'AgentSystem-WeeklyMemoryDecay'
        Description = 'Decay visit_count across personal-brain and agentsystem graphs'
        # Sunday 00:00 local time
        Trigger     = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At '00:00'
        Script      = $null  # multi-command; handled via wrapper below
        Args        = $null
        Log         = "$LogDir\memory-decay.log"
    }
)

if ($Uninstall) {
    foreach ($t in $tasks) {
        if (Get-ScheduledTask -TaskName $t.Name -ErrorAction SilentlyContinue) {
            Unregister-ScheduledTask -TaskName $t.Name -Confirm:$false
            Write-Host "Removed: $($t.Name)"
        } else {
            Write-Host "Not found (already removed?): $($t.Name)"
        }
    }
    exit 0
}

# ── Task 1: WeeklyBrainConsolidation ─────────────────────────────────────────
$t = $tasks[0]
$action = New-ScheduledTaskAction `
    -Execute $NodePath `
    -Argument "$($t.Script) $($t.Args) >> `"$($t.Log)`" 2>&1" `
    -WorkingDirectory $ToolsRoot

$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable:$false

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

if (Get-ScheduledTask -TaskName $t.Name -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $t.Name -Confirm:$false
}
Register-ScheduledTask `
    -TaskName $t.Name `
    -Description $t.Description `
    -Action $action `
    -Trigger $t.Trigger `
    -Settings $settings `
    -Principal $principal | Out-Null
Write-Host "Registered: $($t.Name) (Monday 08:00)"

# ── Task 2: WeeklyMemoryDecay — two commands, use pwsh wrapper ───────────────
$t = $tasks[1]
$decayScript = @"
node "$ToolsRoot\memory-decay.js" --brain=agentsystem >> "$($t.Log)" 2>&1
node "$ToolsRoot\memory-decay.js" --brain=personal-brain >> "$($t.Log)" 2>&1
"@
$wrapperPath = "$ToolsRoot\memory-decay-wrapper.ps1"
Set-Content -Path $wrapperPath -Value $decayScript -Encoding utf8

$action2 = New-ScheduledTaskAction `
    -Execute 'pwsh.exe' `
    -Argument "-NonInteractive -File `"$wrapperPath`"" `
    -WorkingDirectory $ToolsRoot

$settings2 = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable:$false

if (Get-ScheduledTask -TaskName $t.Name -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $t.Name -Confirm:$false
}
Register-ScheduledTask `
    -TaskName $t.Name `
    -Description $t.Description `
    -Action $action2 `
    -Trigger $t.Trigger `
    -Settings $settings2 `
    -Principal $principal | Out-Null
Write-Host "Registered: $($t.Name) (Sunday 00:00)"

Write-Host ""
Write-Host "Done. Tasks registered for current user ($env:USERNAME)."
Write-Host "Verify in Task Scheduler: taskschd.msc"
Write-Host "Log output: $LogDir\"
Write-Host ""
Write-Host "Skipped (requires manual fix):"
Write-Host "  - daily-standup: needs active claude session (cannot run headlessly)"
Write-Host "  - weekly-trust-scores: compute-trust-scores.js has ESM/CJS bug (uses require in ESM scope)"
