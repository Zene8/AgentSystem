# setup-webhook-autostart.ps1 — register a Windows Task Scheduler logon task that
# starts tools/mission-control/webhook-server.js on user logon and keeps it running.
#
# Task registered:
#   AgentSystem-WebhookServer — At log on of current user, runs node
#     tools/mission-control/webhook-server.js with real file logging via cmd.exe
#     redirection (Task Scheduler has no shell of its own, so redirection must be
#     done by an intermediate shell — see the same fix applied in
#     setup-scheduled-tasks.ps1 Task 1).
#
# Usage (no admin required for CURRENT_USER logon tasks):
#   pwsh -File tools/setup-webhook-autostart.ps1
# To remove:
#   pwsh -File tools/setup-webhook-autostart.ps1 -Uninstall
#
# Env vars consumed by webhook-server.js (set them as machine/user env vars
# before registering, or edit $EnvBlock below):
#   PORT                  — default 8765
#   HOST                  — default 127.0.0.1 (LAN exposure is opt-in only; set
#                            HOST=0.0.0.0 explicitly to bind all interfaces)
#   GITHUB_WEBHOOK_SECRET — HMAC secret for POST /github signature verification
#   ALLOWED_ORIGIN        — optional CORS allow-origin (no origin = no CORS header)

param([switch]$Uninstall)

$TaskName    = 'AgentSystem-WebhookServer'
$NodePath    = (Get-Command node -ErrorAction Stop).Source
$RepoRoot    = "C:\Users\natha\dev\AgentSystem"
$ScriptPath  = "$RepoRoot\tools\mission-control\webhook-server.js"
$LogDir      = "C:\Users\natha\dev\AgentSystem\logs"
$LogFile     = "$LogDir\webhook-server.log"

if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Force $LogDir | Out-Null }

if ($Uninstall) {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "Removed: $TaskName"
    } else {
        Write-Host "Not found (already removed?): $TaskName"
    }
    exit 0
}

if (-not (Test-Path $ScriptPath)) {
    Write-Error "webhook-server.js not found at $ScriptPath"
    exit 1
}

# Task Scheduler launches the target executable directly with no shell, so
# stdout/stderr redirection (">> log 2>&1") is meaningless as a node.exe
# argument — it gets passed through literally as argv and node ignores it.
# Route through cmd.exe /c, which understands redirection, so real logging
# actually happens (this mirrors the fix applied to Task 1 in
# setup-scheduled-tasks.ps1).
$action = New-ScheduledTaskAction `
    -Execute 'cmd.exe' `
    -Argument "/c `"`"$NodePath`" `"$ScriptPath`" >> `"$LogFile`" 2>&1`"" `
    -WorkingDirectory $RepoRoot

# Run at logon, restart on failure, keep running indefinitely (no execution
# time limit — this is a long-running server, not a batch job).
$trigger = New-ScheduledTaskTrigger -AtLogOn

$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable:$false `
    -DontStopOnIdleEnd

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask `
    -TaskName $TaskName `
    -Description 'Runs tools/mission-control/webhook-server.js (Mission Control REST API + panel) at user logon.' `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal | Out-Null

Write-Host "Registered: $TaskName (runs at logon of $env:USERNAME)"
Write-Host "Log output: $LogFile"
Write-Host ""
Write-Host "To start it immediately without logging off: Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "Verify:  curl http://127.0.0.1:8765/sessions -H 'Authorization: Bearer <key from ~/.claude/remote-webhook.key>'"
