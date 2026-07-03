# Mission Control — Webhook Control Plane

Remote dispatch server for Claude Code agent fleet management and Antigravity (agy) session handling. Enables phone/browser-based session spawning, monitoring, and cost tracking.

## Files

- **webhook-server.js** — HTTP REST API for agent dispatch, session management, GitHub webhooks, log streaming, and cost tracking
- **agy-persistence.js** — Tmux-based wrapper for persistent agy background sessions (survives terminal close, enables session resumption)
- **README.md** — This file

## Deployment

### Production Setup (Mini-PC)

1. Copy files to mini-PC:
```bash
scp tools/mission-control/webhook-server.js natha@mini-pc:/home/natha/bin/
scp tools/mission-control/agy-persistence.js natha@mini-pc:/home/natha/bin/
```

2. Create systemd service at /etc/systemd/system/claude-webhook.service:
```ini
[Unit]
Description=Claude Code Webhook Server
After=network-online.target

[Service]
Type=simple
User=natha
ExecStart=/usr/bin/node /home/natha/bin/webhook-server.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
Environment=PORT=8765
```

3. Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable claude-webhook
sudo systemctl start claude-webhook
```

## API Quick Reference

| Method | Path | Purpose |
|--------|------|---------|
| GET | / | Service health |
| GET | /panel | Mobile web panel |
| GET | /sessions | List active sessions |
| GET | /cost | Cost summary |
| GET | /log/:id | Stream logs |
| POST | /run | Spawn new session |
| POST | /github | GitHub webhook receiver |

**Auth:** Authorization: Bearer <key from ~/.claude/remote-webhook.key>

## agy Persistence

The agy-persistence.js module provides tmux-based background execution for agy CLI:

```javascript
import { spawnAgyPersistent, stopAgyPersistent } from './agy-persistence.js';

const session = await spawnAgyPersistent({
  prompt: "review schema",
  repoPath: "/home/natha/dev/genie",
  model: "gemini-2.0-flash",
});

// Later: await stopAgyPersistent({ tmuxSessionName: session.tmuxSessionName });
```

## References

- **Full spec:** docs/mission-control.md
- **Session costs:** tools/session-cost.js
- **Phone access:** tools/setup-phone-access.sh
- **Issues:** #82–#88

## Open Tasks

- Issue #83: Security audit (TLS, auth)
- Issue #85: Full agy dispatcher integration
- Issue #86: Repo picker UI
- Issue #87: Frontend
- Issue #88: Boot resilience