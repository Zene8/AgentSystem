#!/bin/bash
# install-runner.sh — register a GitHub Actions self-hosted runner on THIS Linux
# server so the Sam/Friday audits, /agent dispatch, and scheduled tasks run here,
# co-located with Mission Control. Replaces the separate desktop runner.
#
# The runner is installed as a systemd service (via the runner's own svc.sh), so
# it starts on boot and survives logout.
#
# Usage:
#   bash tools/mission-control/install-runner.sh [options]
#
# Options:
#   --repo <owner/name>   Target repo. Default: derived from `git remote get-url origin`.
#   --token <tok>         Runner registration token. Default: fetched via `gh api` if
#                         gh is authenticated (RUNNER_TOKEN env is also honored).
#   --dir <path>          Install dir. Default: ~/actions-runner.
#   --name <name>         Runner name. Default: <hostname>-mc.
#   --labels <csv>        EXTRA labels (added to the default self-hosted,Linux,X64).
#                         Default: mission-control.
#   --version <x.y.z>     Runner version. Default: latest release.
#   -h | --help           Show this help.
#
# Requirements on this host: curl, tar, and (to auto-fetch the token) an
# authenticated gh CLI. The workflows also need gh, node, git, jq, and the claude
# CLI reachable — this script checks and installs what apt can.

set -euo pipefail

# The GitHub Actions runner refuses to configure as root (and shouldn't run as
# root). Fail early with a clear message rather than deep inside config.sh.
if [ "$(id -u)" = "0" ]; then
  echo "Do not run as root — the runner must run as a normal user." >&2
  echo "Run as your deploy user; this script uses sudo only for the svc.sh step." >&2
  exit 1
fi

REPO=""
TOKEN="${RUNNER_TOKEN:-}"
RUNNER_DIR="$HOME/actions-runner"
RUNNER_NAME="$(hostname)-mc"
EXTRA_LABELS="mission-control"
VERSION=""

while [ $# -gt 0 ]; do
  case "$1" in
    --repo)    REPO="$2"; shift 2 ;;
    --token)   TOKEN="$2"; shift 2 ;;
    --dir)     RUNNER_DIR="$2"; shift 2 ;;
    --name)    RUNNER_NAME="$2"; shift 2 ;;
    --labels)  EXTRA_LABELS="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

# ── Resolve repo (owner/name) from origin if not given ─────────────────────────
if [ -z "$REPO" ]; then
  ORIGIN="$(git -C "$(dirname "${BASH_SOURCE[0]}")" remote get-url origin 2>/dev/null || true)"
  # git@github.com:owner/name.git  |  https://github.com/owner/name.git
  REPO="$(printf '%s' "$ORIGIN" | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##')"
fi
if ! printf '%s' "$REPO" | grep -qE '^[^/]+/[^/]+$'; then
  echo "Could not determine repo (owner/name). Pass --repo <owner/name>." >&2
  exit 1
fi
echo "Repo: $REPO"

# ── Dependencies ───────────────────────────────────────────────────────────────
echo "[1/6] Checking dependencies..."
apt_install() { command -v apt-get &>/dev/null && sudo apt-get update -qq && sudo apt-get install -y "$@" || echo "  !! install '$*' manually" >&2; }
command -v curl &>/dev/null || apt_install curl
command -v tar  &>/dev/null || apt_install tar
command -v jq   &>/dev/null || apt_install jq
command -v git  &>/dev/null || apt_install git
for tool in gh node; do
  command -v "$tool" &>/dev/null && echo "  $tool: $(command -v "$tool")" || echo "  !! $tool not found — CI jobs that use it will fail until installed"
done
if command -v claude &>/dev/null || [ -x "$HOME/.local/bin/claude" ]; then
  echo "  claude CLI: ok"
else
  echo "  !! claude CLI not found — Sam/Friday audits and /agent dispatch will fail until installed"
fi

# ── Registration token ─────────────────────────────────────────────────────────
echo "[2/6] Registration token..."
if [ -z "$TOKEN" ]; then
  if command -v gh &>/dev/null && gh auth status &>/dev/null; then
    echo "  fetching a runner registration token via gh api..."
    TOKEN="$(gh api -X POST "repos/$REPO/actions/runners/registration-token" --jq .token)"
  fi
fi
if [ -z "$TOKEN" ]; then
  echo "  No token. Get one at: https://github.com/$REPO/settings/actions/runners/new"
  read -r -p "  Paste registration token: " TOKEN
fi
[ -n "$TOKEN" ] || { echo "No registration token — aborting." >&2; exit 1; }

# ── Architecture + version ──────────────────────────────────────────────────────
echo "[3/6] Resolving runner package..."
case "$(uname -m)" in
  x86_64|amd64) ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) echo "Unsupported arch: $(uname -m)" >&2; exit 1 ;;
esac
if [ -z "$VERSION" ]; then
  VERSION="$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest | jq -r .tag_name | sed 's/^v//')"
  [ -n "$VERSION" ] && [ "$VERSION" != "null" ] || VERSION="2.319.1"  # fallback pin
fi
TARBALL="actions-runner-linux-${ARCH}-${VERSION}.tar.gz"
URL="https://github.com/actions/runner/releases/download/v${VERSION}/${TARBALL}"
echo "  version $VERSION ($ARCH)"

# ── Download + extract ───────────────────────────────────────────────────────────
echo "[4/6] Installing to $RUNNER_DIR..."
mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"
if [ ! -f "config.sh" ]; then
  curl -fsSL -o "$TARBALL" "$URL"
  tar xzf "$TARBALL"
  rm -f "$TARBALL"
fi
# Runner's own OS-level prerequisites (libicu, etc.) — without these the service
# starts and immediately crashes on a fresh Ubuntu box.
if [ -x ./bin/installdependencies.sh ]; then
  sudo ./bin/installdependencies.sh || echo "  !! installdependencies.sh failed — install libicu manually if the runner won't start"
fi

# ── Configure (idempotent via --replace) ─────────────────────────────────────────
echo "[5/6] Configuring runner '$RUNNER_NAME'..."
# Default labels self-hosted,Linux,X64 are added automatically; EXTRA_LABELS augment them.
# The workflows target `runs-on: [self-hosted, Linux]`, which the defaults satisfy.
./config.sh \
  --unattended \
  --replace \
  --url "https://github.com/$REPO" \
  --token "$TOKEN" \
  --name "$RUNNER_NAME" \
  --labels "$EXTRA_LABELS"

# ── Install as a boot-persistent systemd service ──────────────────────────────────
echo "[6/6] Installing systemd service..."
sudo ./svc.sh install "$(whoami)"
sudo ./svc.sh start

echo "-----------------------------------------------------------------"
echo "  Self-hosted runner '$RUNNER_NAME' online for $REPO."
echo "  status: sudo ./svc.sh status   (from $RUNNER_DIR)"
echo "  This host now runs the Sam/Friday audits, /agent dispatch, and cron tasks."
echo "  Verify at: https://github.com/$REPO/settings/actions/runners"
echo "================================================================="
