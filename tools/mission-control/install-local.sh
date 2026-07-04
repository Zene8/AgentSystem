#!/bin/bash
# install-local.sh
# Personal Mini-PC (Intel N100) / Local Ubuntu Desktop Installer
# Run on the target Ubuntu machine: bash tools/mission-control/install-local.sh

set -e

echo "================================================================="
echo "⚡ Mission Control Installer - Ubuntu Desktop (N100 Mini-PC) ⚡"
echo "================================================================="

# 1. Check requirements
echo "Checking system requirements..."
if ! command -v git &>/dev/null; then
  echo "Installing Git..."
  sudo apt-get update && sudo apt-get install -y git
fi

if ! command -v tmux &>/dev/null; then
  echo "Installing tmux..."
  sudo apt-get update && sudo apt-get install -y tmux
fi

if ! command -v node &>/dev/null; then
  echo "Installing Node.js 22 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

# Verify user match
CURRENT_USER=$(whoami)
echo "Current user is: $CURRENT_USER"

# Check if we need to adjust User in systemd template
SERVICE_FILE="tools/mission-control/claude-webhook.service"
if [ "$CURRENT_USER" != "natha" ]; then
  echo "Adjusting systemd service user to '$CURRENT_USER'..."
  sed -i "s/User=natha/User=$CURRENT_USER/g" "$SERVICE_FILE"
  sed -i "s|/home/natha/dev/AgentSystem|$(pwd)|g" "$SERVICE_FILE"
fi

# 2. Setup directories
echo "Configuring Agent System directories..."
mkdir -p "$HOME/agent-memory/nexus/tasks"
mkdir -p "$HOME/.claude"

# 3. Setup credentials key if missing
KEY_FILE="$HOME/.claude/remote-webhook.key"
if [ ! -f "$KEY_FILE" ]; then
  echo "Generating secure Authorization key..."
  openssl rand -hex 32 > "$KEY_FILE"
  chmod 600 "$KEY_FILE"
  echo "Key saved to $KEY_FILE"
fi

# 4. Install dependencies
echo "Installing Node packages..."
npm install --omit=dev

# 5. Enable UFW port
if command -v ufw &>/dev/null; then
  if sudo ufw status | grep -q "active"; then
    echo "Enabling Port 8765 in UFW firewall..."
    sudo ufw allow 8765/tcp
  fi
fi

# 6. Install systemd service
echo "Installing systemd service..."
sudo cp "$SERVICE_FILE" /etc/systemd/system/claude-webhook.service
sudo systemctl daemon-reload
sudo systemctl enable claude-webhook.service
sudo systemctl restart claude-webhook.service

echo "-----------------------------------------------------------------"
echo "✔ Mission Control successfully installed and started!"
echo "Server Port:  8765"
echo "Active Key:   $(cat $KEY_FILE)"
echo "Local Access: http://localhost:8765/panel?key=$(cat $KEY_FILE)"
echo "================================================================="
