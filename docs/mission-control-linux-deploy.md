# Mission Control — Remote Linux Server Deployment

How to install and run the Mission Control webhook server on a headless Linux
server (Ubuntu/Debian) so you can dispatch and monitor Claude Code / Antigravity
agents from a phone or laptop.

This is the **Linux** deployment guide. `mission-control-windows-deploy.md` is a
historical note about a Windows desktop host and is **not** the path for a real
server — use this document.

---

## 1. What gets installed

- **`tools/mission-control/webhook-server.js`** — a Node.js (stdlib-only) HTTP
  server. REST API + a mobile web panel at `/panel`.
- A **systemd service** (`claude-webhook`) that runs it with `Restart=always`,
  logging to the journal.
- A **bearer key** at `~/.claude/remote-webhook.key` (auto-generated, `chmod 600`).
- A **repo allowlist** at `~/agent-memory/nexus/known-repos.json` (seeded with the
  current repo; `POST /run` refuses any repo not listed here).

Requirements: Node ≥ 20 (installer pulls Node 22), `tmux` (for persistent `agy`
sessions), and the `claude` CLI on `PATH` or at `~/.local/bin/claude` (the server
shells out to it — install it separately; the agent harness itself).

---

## 2. Install

```bash
git clone <repo> ~/AgentSystem && cd ~/AgentSystem
# base agent system:
./install.sh
# then the mission-control server (or pass --with-mission-control to install.sh):
bash tools/mission-control/install-local.sh
```

By default this installs a **system** service bound to **loopback (127.0.0.1)** —
the safe default. Nothing is exposed to the network until you opt in.

### Co-locating the GitHub Actions self-hosted runner (recommended)

The Sam/Friday audits, `/agent` dispatch, and scheduled cron workflows all run on a
**self-hosted runner** (`runs-on: [self-hosted, Linux]`). Install one on this same
box so CI is co-located with Mission Control and there's no dependency on a separate
desktop:

```bash
# authenticate gh with repo-admin scope first (auto-fetches the registration token):
gh auth login
bash tools/mission-control/install-runner.sh
# or fold it into the mission-control install:
bash tools/mission-control/install-local.sh --with-runner
# no gh admin? pass a token from repo Settings > Actions > Runners > New:
bash tools/mission-control/install-runner.sh --token <registration-token>
```

The runner installs as its own boot-persistent systemd service (via the runner's
`svc.sh`). It gets the built-in labels `self-hosted, Linux, X64` (plus
`mission-control`), which satisfy the workflows' `[self-hosted, Linux]` target. The
audit/dispatch workflows shell out to `gh` and the `claude` CLI, resolving them by
absolute path (`~/.local/bin` first) so the runner's minimal service PATH is a
non-issue — but both CLIs must be installed on this host.

### Installer options

| Flag | Effect |
|------|--------|
| `--user` | Install as a `systemd --user` service (no sudo). Enables linger so it survives logout/reboot. |
| `--lan` | Bind `0.0.0.0` and open the port in UFW. LAN-reachable. |
| `--bind <addr>` | Bind a specific address (e.g. a Tailscale IP `100.x.y.z`). Preferred over `--lan`. |
| `--port <n>` | Listen port (default 8765). |
| `--public-url <url>` | Advertise this base URL in API responses (behind a proxy/Tailscale). |
| `--no-service` | Set everything up but don't install/start systemd (run manually). |

---

## 3. Reaching it (three options, most→least secure)

**A. SSH tunnel (default, no exposure).** Leave the server on loopback:
```bash
ssh -L 8765:127.0.0.1:8765 user@server
# then open http://localhost:8765/panel?key=$(ssh user@server cat .claude/remote-webhook.key)
```

**B. Tailscale (recommended for phone access).** Install Tailscale on the server
and phone, then bind the Tailscale IP:
```bash
bash tools/mission-control/install-local.sh --bind "$(tailscale ip -4)" \
  --public-url "http://$(tailscale ip -4):8765"
```
Only devices on your tailnet can reach it. Add `tailscale serve` for HTTPS.

**C. Public + reverse proxy with TLS.** If it must face the internet, never expose
the Node port directly — front it with nginx/Caddy doing TLS, and bind the app to
loopback:
```nginx
server {
  listen 443 ssl;
  server_name mc.example.com;
  ssl_certificate     /etc/letsencrypt/live/mc.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/mc.example.com/privkey.pem;
  location / {
    proxy_pass http://127.0.0.1:8765;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```
Install with `--public-url https://mc.example.com` so advertised log URLs are
correct. The server reads `X-Forwarded-Proto` to build `https://` URLs.

---

## 4. Security posture

The only guards on the agent-spawn API are a **timing-safe bearer key** and a
**100 req/min per-IP rate limit**. There is no user model. Therefore:

- **Never bind `0.0.0.0` on a public server** without TLS + a trusted network in
  front. On a public box, prefer Tailscale or an SSH tunnel.
- Keep `~/.claude/remote-webhook.key` `chmod 600`; rotate it periodically
  (regenerate the file and restart the service).
- Optional IP allowlist: `~/.claude/webhook-allowlist.json`
  `{ "allow": ["100.64.0.0/10", "192.168.1.0/24"] }`.
- Optional GitHub webhook HMAC: set `GITHUB_WEBHOOK_SECRET` in the unit
  (`systemctl edit claude-webhook`) — `/github` returns 401 without it.
- Only repos in `known-repos.json` can be dispatched; path traversal and absolute
  paths are rejected by `repo-validator.js`.

---

## 5. Configuration reference (environment variables)

| Var | Default | Meaning |
|-----|---------|---------|
| `HOST` | `127.0.0.1` | Bind address. |
| `PORT` | `8765` | Listen port. |
| `PUBLIC_URL` | *(unset)* | Base URL advertised in responses (behind proxy/Tailscale). |
| `CLAUDE_BIN` | `~/.local/bin/claude` | Path to the `claude` CLI. |
| `GITHUB_WEBHOOK_SECRET` | *(unset)* | HMAC secret for `POST /github`. |
| `ALLOWED_ORIGIN` | *(off)* | Opt-in CORS origin (never `*`). |
| `AGY_ALLOW_DANGEROUS_SKIP_PERMISSIONS` | *(off)* | Antigravity permission bypass. |

Files: key `~/.claude/remote-webhook.key` · allowlist
`~/agent-memory/nexus/known-repos.json` · IP allowlist
`~/.claude/webhook-allowlist.json` · run logs `~/.claude/agent-runs/` · session
registry `~/.claude/mission-control-registry.json` · audit log
`~/.claude/mission-control-audit.jsonl`.

---

## 6. Operate

```bash
# system service
sudo systemctl status claude-webhook
sudo journalctl -u claude-webhook -f
sudo systemctl restart claude-webhook

# --user service
systemctl --user status claude-webhook
journalctl --user -u claude-webhook -f

# health check
curl -s localhost:8765/health
```

### Troubleshooting

- **Service exits immediately** → missing `~/.claude/remote-webhook.key`
  (the server refuses to start without it). Re-run the installer.
- **`POST /run` → 4xx "unknown repo"** → the repo isn't in `known-repos.json`.
- **`claude: not found` in the journal** → the CLI isn't on the service `PATH`;
  set `CLAUDE_BIN` via `systemctl edit claude-webhook`, or install it to
  `~/.local/bin`.
- **Can't reach it from the LAN** → it's loopback-bound by design. Re-install with
  `--lan` / `--bind`, or use an SSH tunnel.
