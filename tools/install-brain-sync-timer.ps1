<#
install-brain-sync-timer.ps1 — the Windows half of the ~15 minute memory sync (#341).

Same job as tools/install-brain-sync-timer.sh, different scheduler: Scheduled Tasks instead of a
systemd --user timer. Both run exactly one command, `node tools/brain-sync-run.js`, so the hooks,
the Linux timer and this agree on behaviour by construction — the lock, the alerting and the
conflict rule all live in that one script, not in the schedulers.

  .\tools\install-brain-sync-timer.ps1              install / update the task
  .\tools\install-brain-sync-timer.ps1 -DryRun      print what would be registered
  .\tools\install-brain-sync-timer.ps1 -Check       exit 1 if the task is missing or points elsewhere
  .\tools\install-brain-sync-timer.ps1 -Uninstall

Runs as the current user, at logon and then every 15 minutes. Note the honest limitation: without a
stored password a Scheduled Task only runs while that user is logged on. That is acceptable *here*
and nowhere else — Windows is the interactive laptop, and the host that must sync unattended is the
Linux box, which gets the systemd unit with linger enabled. If a Windows machine ever needs to sync
while logged out, it needs `-User SYSTEM` or a stored credential, and `gh` auth has to be reachable
from that account. Do not paper over it by assuming this task covers that case.
#>
[CmdletBinding()]
param(
  [switch]$DryRun,
  [switch]$Check,
  [switch]$Uninstall,
  [int]$IntervalMinutes = 15
)

$ErrorActionPreference = 'Stop'

$TaskName  = 'AgentSystem-BrainSync'
$RepoRoot  = Split-Path -Parent $PSScriptRoot
$Script    = Join-Path $RepoRoot 'tools\brain-sync-run.js'
$NodeExe   = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $NodeExe) { Write-Error 'node is not on PATH — install Node or fix PATH before registering a task that needs it.'; exit 2 }

# The task stores an absolute node path and an absolute script path. A task whose command resolves
# through PATH is a task that breaks the first time it runs under a different environment.
$Action    = New-ScheduledTaskAction -Execute $NodeExe -Argument "`"$Script`"" -WorkingDirectory $RepoRoot
# Repetition is set through the -RepetitionInterval parameter, not by assigning $t.Repetition.*
# afterwards: on PowerShell 5.1 the object New-ScheduledTaskTrigger returns has a null Repetition,
# so the assignment dies with "The property 'Interval' cannot be found on this object."
$Triggers  = @(
  $(New-ScheduledTaskTrigger -AtLogOn),
  $(New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
      -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) `
      -RepetitionDuration (New-TimeSpan -Days 365))
)
$Settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
              -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
              -MultipleInstances IgnoreNew

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

if ($Uninstall) {
  if ($existing) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false; Write-Output "removed $TaskName" }
  else { Write-Output "not installed: $TaskName" }
  exit 0
}

if ($DryRun) {
  Write-Output "would register scheduled task: $TaskName"
  Write-Output "  command : `"$NodeExe`" `"$Script`""
  Write-Output "  workdir : $RepoRoot"
  Write-Output "  triggers: at logon, then every $IntervalMinutes minutes"
  Write-Output "  present : $(if ($existing) { 'yes (would be replaced)' } else { 'no' })"
  exit 0
}

if ($Check) {
  # Existence is not the check. A task registered last month against a moved checkout still shows up
  # as healthy in Task Scheduler and has been running the wrong script the whole time — the same
  # installed-but-inert shape the hook --check exists to catch.
  if (-not $existing) { Write-Output "missing    $TaskName"; exit 1 }
  # Checked by meaning, not by string-equality with the path this run would register: the checkout
  # can legitimately live somewhere else than the copy running this script (a worktree, a second
  # clone), and a check that is red on a healthy host gets muted. What must hold is that it runs
  # node against a brain-sync-run.js that still exists.
  $cmd = ($existing.Actions | Select-Object -First 1)
  $target = ([regex]::Match($cmd.Arguments, '"([^"]*brain-sync-run\.js)"')).Groups[1].Value
  $exeOk  = $cmd.Execute -like '*node*'
  if (-not $exeOk -or -not $target -or -not (Test-Path $target)) {
    Write-Output "drift      $TaskName runs: $($cmd.Execute) $($cmd.Arguments)"
    Write-Output "           that script is not on disk — the checkout moved or was deleted"
    exit 1
  }
  $info = Get-ScheduledTaskInfo -TaskName $TaskName
  Write-Output "in sync    $TaskName"
  Write-Output "last       $($info.LastRunTime) (result $($info.LastTaskResult))"
  exit 0
}

if ($existing) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false }
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Triggers -Settings $Settings `
  -Description 'Agent memory continuous sync every 15 min (see #341)' | Out-Null
Write-Output "installed: $TaskName (every $IntervalMinutes minutes)"
Get-ScheduledTaskInfo -TaskName $TaskName | Format-List TaskName, NextRunTime, LastRunTime, LastTaskResult
