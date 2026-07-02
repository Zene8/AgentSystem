#!/bin/bash
# setup-phone-access.sh — Configure phone access to Claude agent system
# Handles: local LAN (WSL2 port forward) + Cloudflare Tunnel (remote/internet)
set -e

HOME_DIR="$HOME"
WSL_IP=$(hostname -I | awk '{print $1}')
WIN_IP=$(ip route show | grep "default via" | awk '{print $3}')
PORT=8765
KEY=$(cat "$HOME_DIR/.claude/remote-webhook.key" 2>/dev/null || echo "KEY_NOT_FOUND")
KEY_SHORT="${KEY:0:8}...${KEY: -4}"

echo ""
echo "═══════════════════════════════════════════════════"
echo "  Claude Agent System — Phone Access Setup"
echo "═══════════════════════════════════════════════════"
echo ""

# ── Option 1: Official claude.ai remote control (already works!) ─────────────
echo "┌─ Option 1: Official Remote Control (RECOMMENDED, already active)"
echo "│"
echo "│  1. Open claude.ai on your phone"
echo "│  2. Tap Code → Connect to local session"
echo "│  3. Your sessions appear under remote control"
echo "│"
echo "│  Sessions auto-register on start (remoteControlAtStartup=true)"
echo "│  Full interactive access — read output, send messages, full control"
echo ""

# ── Option 2: Local network webhook (same WiFi) ──────────────────────────────
echo "┌─ Option 2: Local Network Webhook (same WiFi only)"
echo "│"
echo "│  WSL IP:     $WSL_IP:$PORT"
echo "│  Windows IP: $WIN_IP:$PORT"
echo "│  Panel URL:  http://$WIN_IP:$PORT/panel?key=$KEY"
echo "│"
echo "│  Windows port forward needed (run as Admin in PowerShell):"
echo "│  > netsh interface portproxy add v4tov4 listenport=$PORT listenaddress=0.0.0.0 connectport=$PORT connectaddress=$WSL_IP"
echo "│  > netsh advfirewall firewall add rule name='Claude Webhook' dir=in action=allow protocol=TCP localport=$PORT"
echo "│"
echo "│  To remove port forward:"
echo "│  > netsh interface portproxy delete v4tov4 listenport=$PORT listenaddress=0.0.0.0"
echo ""

# ── Option 3: Cloudflare Tunnel (internet access, no port forward) ───────────
echo "┌─ Option 3: Cloudflare Tunnel (internet access, free)"
echo "│"
if command -v cloudflared &>/dev/null; then
  echo "│  cloudflared found — starting tunnel..."
  cloudflared tunnel --url "http://127.0.0.1:$PORT" &
  TUNNEL_PID=$!
  sleep 3
  echo "│  Tunnel PID: $TUNNEL_PID"
  echo "│  Tunnel URL will appear in cloudflared output above"
else
  echo "│  cloudflared not installed. Install:"
  echo "│"
  echo "│  curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cf.deb"
  echo "│  sudo dpkg -i /tmp/cf.deb"
  echo "│"
  echo "│  Then: cloudflared tunnel --url http://127.0.0.1:$PORT"
  echo "│  Or permanent: cloudflare.com/zero-trust → Tunnels (free tier available)"
fi
echo ""

# ── Quick test ───────────────────────────────────────────────────────────────
echo "┌─ Quick Test"
echo "│"
if curl -s -f -H "Authorization: Bearer $KEY" "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then
  echo "│  ✅ Webhook server running on port $PORT"
else
  echo "│  ⚠️  Webhook server not responding — start it:"
  echo "│  systemctl --user start claude-webhook"
fi
echo ""

# ── Auth key QR / curl snippet ───────────────────────────────────────────────
echo "┌─ Curl snippet (test from phone terminal):"
echo "│"
echo "│  curl -s -X POST http://<YOUR-IP>:$PORT/run \\"
echo "│    -H 'Authorization: Bearer $KEY' \\"
echo "│    -H 'Content-Type: application/json' \\"
echo "│    -d '{\"agent\":\"friday\",\"prompt\":\"check CI status\"}'"
echo ""
echo "═══════════════════════════════════════════════════"
echo "  Your webhook key: $KEY_SHORT"
echo "  Full key in: ~/.claude/remote-webhook.key"
echo "═══════════════════════════════════════════════════"
echo ""
