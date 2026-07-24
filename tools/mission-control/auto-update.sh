#!/bin/bash
# auto-update.sh — pull the latest main and restart Mission Control.
#
# Run by the mission-control-update.timer (daily). Safe by design:
#   - only acts when the deploy checkout is on $BRANCH and has a clean worktree
#   - fast-forward only (never rewrites local history; a diverged checkout fails
#     loudly instead of clobbering)
#   - restarts the webhook service ONLY when HEAD actually moved (no needless
#     downtime on a no-op day)
#
# Config via environment (the installer bakes these into the systemd unit):
#   REPO_ROOT     absolute path to the repo checkout the service runs from  (required)
#   SERVICE       systemd unit to restart            (default claude-webhook.service)
#   MODE          system | user                      (default user)
#   DEPLOY_USER   repo-owning user (system mode runs git as this user via sudo)
#   BRANCH        branch to track                    (default main)
set -euo pipefail

REPO_ROOT="${REPO_ROOT:?REPO_ROOT env is required}"
SERVICE="${SERVICE:-claude-webhook.service}"
MODE="${MODE:-user}"
BRANCH="${BRANCH:-main}"
DEPLOY_USER="${DEPLOY_USER:-$(id -un)}"

log() { echo "[auto-update] $*"; }

# In system mode this script runs as root, but the checkout is owned by the
# deploy user — run git/npm as that user so file ownership and ~/.ssh creds are
# correct. In user mode we already are that user.
run_as_user() {
  if [ "$MODE" = "system" ] && [ "$DEPLOY_USER" != "$(id -un)" ]; then
    sudo -u "$DEPLOY_USER" "$@"
  else
    "$@"
  fi
}
git_() { run_as_user git -C "$REPO_ROOT" "$@"; }
restart_service() {
  if [ "$MODE" = "system" ]; then systemctl restart "$SERVICE"
  else systemctl --user restart "$SERVICE"; fi
}

branch="$(git_ rev-parse --abbrev-ref HEAD)"
if [ "$branch" != "$BRANCH" ]; then
  log "checkout is on '$branch', not '$BRANCH' — skipping"; exit 0
fi
if [ -n "$(git_ status --porcelain)" ]; then
  log "working tree has local changes — skipping (resolve manually)"; exit 0
fi

git_ fetch --quiet origin "$BRANCH"
before="$(git_ rev-parse HEAD)"
after="$(git_ rev-parse "origin/$BRANCH")"
if [ "$before" = "$after" ]; then
  log "already up to date (${before:0:8})"; exit 0
fi

log "updating ${before:0:8} -> ${after:0:8}"
git_ merge --ff-only "origin/$BRANCH"

# Server is stdlib-only, but sync deps in case that changes. Non-fatal.
if command -v npm >/dev/null 2>&1; then
  run_as_user npm --prefix "$REPO_ROOT" install --omit=dev --silent \
    || log "npm install failed (non-fatal for stdlib-only server)"
fi

restart_service
log "updated to ${after:0:8} and restarted $SERVICE"
