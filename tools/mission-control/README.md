# Mission Control — Webhook Control Plane

Remote dispatch server for Claude Code agent fleet management. REST API + mobile web panel for starting background agents, monitoring sessions, and tracking costs.

## Files

- **webhook-server.js** — HTTP server handling agent dispatch, session management, GitHub webhooks, and cost tracking
  - Health endpoint: `GET /` 
  - Mobile panel: `GET /panel?key=<key>`
  - Session list: `GET /sessions`
  - Cost summary: `GET /cost`
  - Agent dispatch: `POST /run` (body: `{agent, prompt, cwd?}`)
  - GitHub webhook: `POST /github`
  - Log tail: `GET /log/:sessionId`
  - Auth: `Authorization: Bearer <key>`

## Deployment

### Local Development (macOS / Linux / WSL)

The server runs automatically via daemon. No manual setup needed for local work.

To test locally:
```bash
node tools/mission-control/webhook-server.js
# or start the daemon if not running
node ~/.local/bin/claude agents
```

### Production (mini-PC)

#### Systemd Service Setup

1. Copy webhook-server.js to the mini-PC:
   ```bash
   scp tools/mission-control/webhook-server.js natha@mini-pc:/home/natha/bin/
   ```

2. Create systemd service: `/etc/systemd/system/claude-webhook.service`
   ```ini
   [Unit]
   Description=Claude Code Webhook Server
   After=network.target
   Wants=network-online.target
   
   [Service]
   Type=simple
   User=natha
   WorkingDirectory=/home/natha
   ExecStart=/usr/bin/node /home/natha/bin/webhook-server.js
   Restart=always
   RestartSec=5
   StandardOutput=journal
   StandardError=journal
   Environment="PORT=8765"
   Environment="GITHUB_WEBHOOK_SECRET=<your-webhook-secret>"
   
   [Install]
   WantedBy=multi-user.target
   ```

3. Enable and start:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable claude-webhook.service
   sudo systemctl start claude-webhook.service
   ```

4. Check status:
   ```bash
   sudo systemctl status claude-webhook.service
   sudo journalctl -u claude-webhook.service -f
   ```

#### Authentication

The server requires a secret key at `~/.claude/remote-webhook.key`. All requests must include:
```
Authorization: Bearer <key-from-file>
```

#### GitHub Webhook Integration

1. Set `GITHUB_WEBHOOK_SECRET` env var in systemd service or `.env`:
   ```bash
   export GITHUB_WEBHOOK_SECRET="<your-webhook-secret>"
   ```

2. In GitHub repo settings → Webhooks → Payload URL:
   ```
   http://<mini-pc-ip>:8765/github
   ```

3. Events: select "Let me select individual events"
   - Push
   - Pull request
   - Issues

4. Auto-routing:
   - PR opened → Friday
   - Push to main → Leo
   - New issue → Jarvis
   - CI failure → Leo

## Verification

### Health Check
```bash
# Local
curl -H "Authorization: Bearer $(cat ~/.claude/remote-webhook.key)" \
  http://localhost:8765/

# Remote
curl -H "Authorization: Bearer <key>" \
  http://<mini-pc-ip>:8765/
```

### List Running Sessions
```bash
curl -H "Authorization: Bearer $(cat ~/.claude/remote-webhook.key)" \
  http://localhost:8765/sessions | jq .
```

### View Cost Summary
```bash
curl -H "Authorization: Bearer $(cat ~/.claude/remote-webhook.key)" \
  http://localhost:8765/cost
```

### Tail Agent Logs
```bash
curl -H "Authorization: Bearer $(cat ~/.claude/remote-webhook.key)" \
  http://localhost:8765/log/<session-id>
```

### Dispatch Agent (Post)
```bash
curl -X POST \
  -H "Authorization: Bearer $(cat ~/.claude/remote-webhook.key)" \
  -H "Content-Type: application/json" \
  -d '{"agent":"friday","prompt":"audit branch main","cwd":"/home/natha/dev/MyRepo"}' \
  http://localhost:8765/run
```

## Security

1. **Key file** — Store at `~/.claude/remote-webhook.key`, NOT in git
2. **HTTPS** — Use reverse proxy (nginx/caddy) in production
3. **Firewall** — Restrict port 8765 to trusted IPs or VPN
4. **GitHub Secret** — Set `GITHUB_WEBHOOK_SECRET` env var; webhook signature verified before routing
5. **Audit log** — All dispatches logged to `~/.claude/agent-runs/`

## Monitoring

Logs streamed to systemd journal:
```bash
# Watch in real-time
sudo journalctl -u claude-webhook.service -f

# Last 50 lines
sudo journalctl -u claude-webhook.service -n 50

# Errors only
sudo journalctl -u claude-webhook.service -p err
```

## Troubleshooting

### Server won't start
- Check key file exists: `ls -la ~/.claude/remote-webhook.key`
- Check port 8765 is available: `lsof -i :8765` or `netstat -an | grep 8765`
- Check Node.js version ≥ 18: `node --version`

### Auth failures
- Verify key is correct: `cat ~/.claude/remote-webhook.key`
- Ensure Authorization header is present and formatted: `Authorization: Bearer <key>`

### GitHub webhook not routing
- Check webhook was sent: GitHub repo → Settings → Webhooks → Recent Deliveries
- Verify secret matches: `echo $GITHUB_WEBHOOK_SECRET`
- Check agent is available: `claude agents`

## Architecture & Context

Full specification in `docs/mission-control.md`:
- Design rationale for versioning control-plane code
- Deployment topology (local daemon vs. mini-PC systemd)
- REST API specification
- GitHub webhook routing rules
- Security model

---

Issue: #84 — Version control the mission control webhook server
