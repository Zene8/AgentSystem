<#
install-inbound-timers.ps1 -- Windows scheduled tasks for the inbound event-triage poller (#483, phase 4).

Same job as tools/install-inbound-timers.sh, different scheduler: Scheduled Tasks instead of
systemd --user timers. Three tasks, one per cadence tier:
  - AgentSystem-InboundTimerFast (every 2 minutes)
  - AgentSystem-InboundTimerMedium (every 10 minutes)
  - AgentSystem-InboundTimerDaily (every 1 day)

Each runs exactly one command, `node tools/inbound/poll-run.js --cadence=<tier> --alert`, so
the hooks, the Linux timers and this agree on behaviour by construction.

ASCII only, deliberately. The BOM and UTF-8 hazards are the same as install-brain-sync-timer.ps1.

  .\tools\install-inbound-timers.ps1              install / update all three tasks
  .\tools\install-inbound-timers.ps1 -DryRun      print what would be registered
  .\tools\install-inbound-timers.ps1 -Check       exit 1 if any task is missing or points elsewhere
  .\tools\install-inbound-timers.ps1 -Uninstall

Runs as the current user, at logon and then at the cadence interval. The honest limitation is
the same as brain-sync-timer.ps1: without a stored password a Scheduled Task only runs while
that user is logged on. Windows is the interactive laptop; the host that must poll unattended
is Linux, which gets systemd --user timers with linger enabled.
#>
[CmdletBinding()]
param(
  [switch]$DryRun,
  [switch]$Check,
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

$RepoRoot  = Split-Path -Parent $PSScriptRoot
$Script    = Join-Path $RepoRoot 'tools\inbound\poll-run.js'
$NodeExe   = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $NodeExe) { Write-Error 'node is not on PATH -- install Node or fix PATH before registering tasks that need it.'; exit 2 }

# $LIFE_REPO must be set in the environment, or every adapter will fail closed.
if (-not $env:LIFE_REPO) { Write-Error '$LIFE_REPO is not set in the environment — set it to the Life OS checkout root.'; exit 5 }

# Three tiers, each with a name, an interval in minutes, and a cadence tier for the poller.
$Tiers = @(
  @{ Name = 'AgentSystem-InboundTimerFast';   Minutes = 2;  Tier = 'fast' }
  @{ Name = 'AgentSystem-InboundTimerMedium'; Minutes = 10; Tier = 'medium' }
  @{ Name = 'AgentSystem-InboundTimerDaily';  Minutes = 1440; Tier = 'daily' }  # 1440 = 24 hours
)

function New-InboundTask {
  param([hashtable]$Tier)

  $Action = New-ScheduledTaskAction `
    -Execute $NodeExe `
    -Argument "`"$Script`" --cadence=$($Tier.Tier) --alert" `
    -WorkingDirectory $RepoRoot

  # Repetition is set through -RepetitionInterval, not by assigning $t.Repetition.* afterwards.
  # A finite repetition duration silently expires on its end date, which is the exact hazard
  # this whole exercise is about (see install-brain-sync-timer.ps1). The Repetition.Duration
  # field is then cleared to drop the element and run indefinitely.
  $Repeating = New-ScheduledTaskTrigger `
    -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes $Tier.Minutes) `
    -RepetitionDuration (New-TimeSpan -Days 1)
  $Repeating.Repetition.Duration = ''
  $Repeating.Repetition.StopAtDurationEnd = $false

  # At-logon trigger is scoped to this user (no -User parameter to New-ScheduledTaskTrigger
  # applies the trigger to this user, not all users).
  $AtLogon = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
  $Triggers = @($AtLogon, $Repeating)

  $Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
    -MultipleInstances IgnoreNew

  return @{ Action = $Action; Triggers = $Triggers; Settings = $Settings }
}

function Register-InboundTask {
  param(
    [hashtable]$Tier,
    [hashtable]$TaskDef
  )

  try {
    Register-ScheduledTask -TaskName $Tier.Name -Action $TaskDef.Action `
      -Trigger $TaskDef.Triggers -Settings $TaskDef.Settings `
      -Description "Inbound event-triage poller for $($Tier.Tier) tier (every $($Tier.Minutes) min, see #483)" `
      -ErrorAction Stop | Out-Null
    return $true
  } catch {
    Write-Output "failed to register $($Tier.Name) : $($_.Exception.Message)"
    return $false
  }
}

if ($Uninstall) {
  foreach ($tier in $Tiers) {
    $existing = Get-ScheduledTask -TaskName $tier.Name -ErrorAction SilentlyContinue
    if ($existing) {
      Unregister-ScheduledTask -TaskName $tier.Name -Confirm:$false
      Write-Output "removed $($tier.Name)"
    }
  }
  Write-Output "removed inbound-poller scheduled tasks (fast, medium, daily)"
  exit 0
}

if ($DryRun) {
  Write-Output "would register three inbound-poller scheduled tasks:"
  foreach ($tier in $Tiers) {
    $existing = Get-ScheduledTask -TaskName $tier.Name -ErrorAction SilentlyContinue
    Write-Output ""
    Write-Output "  $($tier.Name)"
    Write-Output "    command  : `"$NodeExe`" `"$Script`" --cadence=$($tier.Tier) --alert"
    Write-Output "    workdir  : $RepoRoot"
    Write-Output "    triggers : at logon, then every $($tier.Minutes) minutes"
    Write-Output "    present  : $(if ($existing) { 'yes (would be replaced)' } else { 'no' })"
  }
  exit 0
}

if ($Check) {
  $driftFound = 0

  foreach ($tier in $Tiers) {
    $existing = Get-ScheduledTask -TaskName $tier.Name -ErrorAction SilentlyContinue
    if (-not $existing) {
      Write-Output "missing    $($tier.Name)"
      $driftFound = 1
      continue
    }

    # Check that it still runs the right script. A task registered against a moved checkout
    # still shows as healthy in Task Scheduler but runs the wrong script (installed-but-inert).
    $cmd = ($existing.Actions | Select-Object -First 1)
    $target = ([regex]::Match($cmd.Arguments, '"([^"]*poll-run\.js)"')).Groups[1].Value
    $exeOk  = $cmd.Execute -like '*node*'
    $tierOk = $cmd.Arguments -like "*--cadence=$($tier.Tier)*"

    if (-not $exeOk -or -not $target -or -not (Test-Path $target)) {
      Write-Output "drift      $($tier.Name) points to script: ${target:-<none>}"
      Write-Output "           that script is not on disk — the checkout moved or was deleted"
      $driftFound = 1
      continue
    }

    if (-not $tierOk) {
      Write-Output "drift      $($tier.Name) has wrong cadence argument in: $($cmd.Arguments)"
      $driftFound = 1
      continue
    }

    # Liveness: a task can be registered, point at the right script, and still be dead.
    $info = Get-ScheduledTaskInfo -TaskName $tier.Name
    $result = $info.LastTaskResult
    $lastRun = $info.LastRunTime

    if ($existing.State -eq 'Disabled') {
      Write-Output "drift      $($tier.Name) is Disabled — registered but never fires"
      $driftFound = 1
      continue
    }

    # 0 = fine. 3 = an adapter or cursor failed and an alert was raised (working as designed).
    # 267011 = task has not yet run (OK before the first run).
    $neverRan = ($null -eq $lastRun) -or ($lastRun -lt (Get-Date '1980-01-01')) -or ($result -eq 267011)

    if (-not $neverRan -and $result -notin @(0, 3)) {
      Write-Output "drift      $($tier.Name) last run failed (result $result at $lastRun)"
      $driftFound = 1
      continue
    }

    # Two intervals of slack: one missed firing is acceptable (laptop asleep), but nothing in
    # twice the period means the trigger is not firing. The task before its first run is exempt.
    $staleAfter = (Get-Date).AddMinutes(-2 * $tier.Minutes)
    if (-not $neverRan -and $lastRun -lt $staleAfter) {
      Write-Output "drift      $($tier.Name) has not run since $lastRun (interval is $($tier.Minutes) min)"
      $driftFound = 1
      continue
    }

    Write-Output "in sync    $($tier.Name)"
    if ($neverRan) {
      Write-Output "last       never run yet (registered, waiting for first trigger)"
    } else {
      Write-Output "last       $lastRun (result $result)"
    }
  }

  exit $driftFound
}

# Install mode (default)
foreach ($tier in $Tiers) {
  $existing = Get-ScheduledTask -TaskName $tier.Name -ErrorAction SilentlyContinue
  if ($existing) {
    Unregister-ScheduledTask -TaskName $tier.Name -Confirm:$false
  }

  $taskDef = New-InboundTask -Tier $tier
  if (-not (Register-InboundTask -Tier $tier -TaskDef $taskDef)) {
    exit 1
  }
  Write-Output "installed: $($tier.Name) (every $($tier.Minutes) minutes)"
}

Write-Output ""
Write-Output "all inbound-poller scheduled tasks registered:"
foreach ($tier in $Tiers) {
  $info = Get-ScheduledTaskInfo -TaskName $tier.Name
  Write-Output "  $($tier.Name): next run $($info.NextRunTime), last run $($info.LastRunTime) (result $($info.LastTaskResult))"
}
exit 0
