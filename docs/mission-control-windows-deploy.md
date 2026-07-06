# Mission Control — Windows Host Deploy Notes (issue #160)

Status as of this writing: webhook server code hardened and tested (PR #161), but
**not yet persisted as an autostart service on this host** — see Blocked section.

## 1. Autostart via Task Scheduler

Script: `tools/setup-webhook-autostart.ps1` (mirrors the pattern used for the
`nathan-desktop` self-hosted GitHub Actions runner logon task, and the fix
applied to `setup-scheduled-tasks.ps1` Task 1 for real log redirection).

```powershell
# Register (no admin required for a CURRENT_USER logon task):
pwsh -File tools/setup-webhook-autostart.ps1
# or, if pwsh isn't installed:
powershell -File tools/setup-webhook-autostart.ps1

# Start immediately without logging off/on:
Start-ScheduledTask -TaskName 'AgentSystem-WebhookServer'

# Verify:
curl http://127.0.0.1:8765/sessions -H "Authorization: Bearer $(Get-Content $env:USERPROFILE\.claude\remote-webhook.key)"
```

Env vars honored by `tools/mission-control/webhook-server.js` — set these as
user/machine environment variables *before* registering the task (Task
Scheduler snapshots the environment at registration time):

| Var | Default | Notes |
|---|---|---|
| `PORT` | `8765` | |
| `HOST` | `127.0.0.1` | LAN exposure is opt-in only — set `HOST=0.0.0.0` explicitly to bind all interfaces. |
| `GITHUB_WEBHOOK_SECRET` | (unset) | Required for `POST /github` HMAC verification. Generate with `openssl rand -hex 32` or `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. |
| `ALLOWED_ORIGIN` | (unset = no CORS) | Only needed if a *cross-origin* browser client hits the API directly; the bundled panel is served same-origin and needs nothing here. |

### Blocked: could not register the scheduled task from this session

`Register-ScheduledTask` and `schtasks.exe /Create` both failed with
`Access is denied` (HRESULT 0x80070005) when run from this agent execution
environment, even as the owning user (`natha`) with the Task Scheduler
service running. This reproduces with both the PowerShell cmdlet and the
`schtasks.exe` CLI, so it is a host/session permission restriction on
Task Scheduler access from this context, not a bug in
`setup-webhook-autostart.ps1`.

**Workaround / next step:** run
`pwsh -File tools/setup-webhook-autostart.ps1` from an interactive
(non-agent) PowerShell session on the desktop as `natha`, the same way the
`nathan-desktop` self-hosted runner logon task was originally registered.

**Interim verification done in this session:** the webhook server was
started directly (`node tools/mission-control/webhook-server.js`, foreground,
not via a persisted task) and confirmed working:
`GET /sessions` with `Authorization: Bearer <key>` returned live session
data from `claude agents --json`. This process does **not** survive logoff/
reboot — only the scheduled task provides that.

## 2. GitHub webhook → `/github`

Once the server is persisted and reachable (see below), point a repo webhook
at it:

```bash
gh api repos/Zene8/AgentSystem/hooks -f name=web \
  -f config[url]=<PUBLIC_URL>/github \
  -f config[content_type]=json \
  -f config[secret]=<GITHUB_WEBHOOK_SECRET value set above> \
  -f events[]=pull_request -f events[]=push -f events[]=issues \
  -f events[]=check_run -f events[]=workflow_run \
  -F active=true
```

### Blocked: no public/static reachable URL for this host

This desktop is on a residential/dynamic connection with no port-forwarded
public IP or static DNS name configured, and Mission Control's design intent
(`docs/mission-control.md`) targets a dedicated Ubuntu mini-PC + Tailscale
setup for exactly this reason — the Windows desktop here is not that host.
Creating the external GitHub webhook now would either fail immediately
(unreachable URL) or silently no-op forever.

**Options to unblock, in order of effort:**
1. Set up a Tailscale funnel/serve or Cloudflare Tunnel to this machine and
   use the resulting HTTPS URL.
2. Deploy the mini-PC per `tools/mission-control/install-local.sh` (the
   intended target host) and point the webhook there instead.
3. Skip GitHub push-triggered dispatch entirely and rely on manual
   `/panel` or `POST /run` dispatch — `/github` is additive, not required
   for Mission Control's core spawn functionality.

No GitHub repo webhook has been created as part of this issue.
