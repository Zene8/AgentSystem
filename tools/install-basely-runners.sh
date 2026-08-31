#!/usr/bin/env bash
# install-basely-runners.sh — register and supervise the self-hosted GitHub Actions runners that
# Zene8/Basely's CI runs on.
#
# ── Why this exists ──────────────────────────────────────────────────────────────────────────
# Zene8/Basely is a PRIVATE repo, so hosted-runner minutes are billed. When account payment fails
# or the spending limit is reached, GitHub does not slow the queue — it refuses to START the job:
# every check fails in 4-7s with zero work done and no code signal (#530). Self-hosted runners are
# not metered, so CI keeps telling the truth through a billing outage. Basely's ci.yml,
# sam-audit.yml, pr-evidence-check.yml, workspace-script-guard.yml and db-migration-drift.yml all
# target `[self-hosted, Linux]` for that reason.
#
# The runners were first brought up by hand, which is exactly the failure mode this repo keeps
# re-learning: an install nobody can verify rots silently, and the drift check cannot see it
# (#361, #302). Hence an installer with a --check, wired into enforcement-drift-check.yml.
#
#   bash tools/install-basely-runners.sh               # install/repair + start (needs authenticated gh)
#   bash tools/install-basely-runners.sh --dry-run     # print the units, change nothing
#   bash tools/install-basely-runners.sh --check       # exit 1 if a runner, unit or registration drifted
#   bash tools/install-basely-runners.sh --check-units # units/config on disk only, no GitHub call (tests)
#   bash tools/install-basely-runners.sh --uninstall   # stop, unregister from GitHub, remove units
#
# INSTANCES=n selects how many runners to manage (default 2). Two is the current capacity: Basely's
# ci.yml fans out to five jobs and `needs:` serialises most of them, so a second runner cuts
# wall-clock on the parallel half without oversubscribing the box.
#
# exit codes: 0 = every runner registered, unit written, service enabled and active. 4 = files were
# written but the systemd --user bus was unreachable (or enable failed), so nothing is supervised and
# a human must finish at a console. 5 = `gh` missing/unauthenticated, or no runner tarball reachable,
# so nothing was written. Anything else non-zero = could not write.
#
# systemd --user, not the runner's own `svc.sh install`: svc.sh writes a SYSTEM unit and needs root,
# and this host has no passwordless sudo. Lingering keeps the units firing with nobody logged in.
set -euo pipefail

REPO="${BASELY_REPO:-Zene8/Basely}"
INSTANCES="${INSTANCES:-2}"
RUNNER_VERSION="${RUNNER_VERSION:-2.337.0}"
LABELS="${RUNNER_LABELS:-basely-ci}"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
BASE="$HOME"
PREFIX=actions-runner-basely

MODE="${1:-install}"

die() { echo "error: $*" >&2; exit "${2:-1}"; }

runner_dir() { echo "$BASE/$PREFIX-$1"; }
unit_name()  { echo "$PREFIX-$1.service"; }

service_unit() {
  local n="$1" dir
  dir="$(runner_dir "$n")"
cat <<UNIT
[Unit]
Description=GitHub Actions runner ($REPO) instance $n
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$dir
ExecStart=$dir/run.sh
# A minimal user-unit environment cannot find a node/npm that came from nvm or a tarball, and
# Basely's workflows shell out to both. ~/.local/bin first so a user-installed toolchain wins.
Environment=PATH=$HOME/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Restart=always
RestartSec=10
# KillMode=process so a SIGTERM stops the listener without killing the job process it spawned
# mid-step; the runner drains the job itself. TimeoutStopSec covers a long build.
KillMode=process
KillSignal=SIGTERM
TimeoutStopSec=5min

[Install]
WantedBy=default.target
UNIT
}

require_gh() {
  command -v gh >/dev/null 2>&1 || die "gh is not installed; needed to mint a runner registration token" 5
  gh auth status >/dev/null 2>&1 || die "gh is not authenticated for this user; run gh auth login" 5
}

# --- checks -------------------------------------------------------------------------------------
# with_github=yes also asserts the systemd state and GitHub's own view of the runners. The units-only
# variant exists for the test suite and for hosts that are not the runner host.
check() {
  local with_github="$1" faults=0 n dir unit
  for n in $(seq 1 "$INSTANCES"); do
    dir="$(runner_dir "$n")"; unit="$UNIT_DIR/$(unit_name "$n")"
    if [ ! -x "$dir/run.sh" ]; then
      echo "FAULT: runner $n not unpacked — $dir/run.sh missing or not executable"
      faults=$((faults+1)); continue
    fi
    # .runner is written by config.sh and holds the repo and runner name. An unpacked tarball with
    # no .runner is the installed-but-never-registered state: run.sh starts and exits immediately.
    if [ ! -f "$dir/.runner" ]; then
      echo "FAULT: runner $n unpacked but never registered — $dir/.runner missing"
      faults=$((faults+1)); continue
    fi
    if [ ! -f "$unit" ]; then
      echo "FAULT: runner $n has no unit at $unit"
      faults=$((faults+1)); continue
    fi
    if ! diff -q <(service_unit "$n") "$unit" >/dev/null 2>&1; then
      echo "FAULT: unit for runner $n differs from what this script generates (stale path or options): $unit"
      faults=$((faults+1)); continue
    fi
    if [ "$with_github" = yes ]; then
      if ! systemctl --user is-enabled --quiet "$(unit_name "$n")" 2>/dev/null; then
        echo "FAULT: $(unit_name "$n") is on disk but not enabled — it will not come back after a reboot"
        faults=$((faults+1))
      fi
      if ! systemctl --user is-active --quiet "$(unit_name "$n")" 2>/dev/null; then
        echo "FAULT: $(unit_name "$n") is not active — this runner accepts no jobs"
        faults=$((faults+1))
      fi
    fi
  done

  if [ "$with_github" = yes ]; then
    require_gh
    # The local half can be perfect while GitHub still considers the runner offline (registration
    # revoked in repo settings, token rotated, no route out). Only GitHub's view decides whether a
    # dispatched job is ever picked up, so a green local check alone is not the arbiter.
    local online
    online="$(gh api "repos/$REPO/actions/runners" \
      --jq "[.runners[] | select(.name | startswith(\"$(hostname)-basely-\")) | select(.status==\"online\")] | length" \
      2>/dev/null || echo 0)"
    if [ "$online" -lt "$INSTANCES" ]; then
      echo "FAULT: GitHub reports $online online runner(s) named $(hostname)-basely-*, expected $INSTANCES — a job dispatched now would queue forever"
      faults=$((faults+1))
    fi
  fi

  if [ "$faults" -ne 0 ]; then
    echo "install-basely-runners: $faults fault(s) — repair with: bash tools/install-basely-runners.sh"
    return 1
  fi
  if [ "$with_github" = yes ]; then
    echo "install-basely-runners: $INSTANCES runner(s) registered, units in sync, enabled+active, online at GitHub"
  else
    echo "install-basely-runners: $INSTANCES runner(s) registered, units in sync (systemd and GitHub not checked)"
  fi
  return 0
}

case "$MODE" in
  --check)       check yes; exit $?;;
  --check-units) check no;  exit $?;;
  --dry-run)     for n in $(seq 1 "$INSTANCES"); do echo "--- $UNIT_DIR/$(unit_name "$n") ---"; service_unit "$n"; done; exit 0;;
esac

[ "$(uname -s)" = Linux ] || die "the self-hosted runners live on the Linux host only (got $(uname -s))"

if [ "$MODE" = --uninstall ]; then
  require_gh
  for n in $(seq 1 "$INSTANCES"); do
    systemctl --user disable --now "$(unit_name "$n")" 2>/dev/null || true
    rm -f "$UNIT_DIR/$(unit_name "$n")"
    dir="$(runner_dir "$n")"
    if [ -f "$dir/config.sh" ] && [ -f "$dir/.runner" ]; then
      # Unregister at GitHub before touching the directory, or the repo keeps a phantom offline
      # runner that --check counts against INSTANCES forever.
      tok="$(gh api --method POST "repos/$REPO/actions/runners/remove-token" --jq .token)"
      (cd "$dir" && ./config.sh remove --token "$tok") \
        || echo "warn: could not unregister runner $n; remove it in the repo's Actions settings" >&2
    fi
  done
  systemctl --user daemon-reload 2>/dev/null || true
  echo "uninstalled $INSTANCES runner unit(s); runner directories left in place under $BASE"
  exit 0
fi

require_gh
mkdir -p "$UNIT_DIR"

TARBALL="actions-runner-linux-x64-$RUNNER_VERSION.tar.gz"
for n in $(seq 1 "$INSTANCES"); do
  dir="$(runner_dir "$n")"
  mkdir -p "$dir"
  if [ ! -x "$dir/run.sh" ]; then
    if [ ! -f "$BASE/$TARBALL" ]; then
      curl -fsSL -o "$BASE/$TARBALL" \
        "https://github.com/actions/runner/releases/download/v$RUNNER_VERSION/$TARBALL" \
        || die "could not download $TARBALL" 5
    fi
    tar xzf "$BASE/$TARBALL" -C "$dir"
  fi
  if [ ! -f "$dir/.runner" ]; then
    # Registration tokens are single-use and expire in about an hour, so mint one per runner rather
    # than reusing one across the loop.
    tok="$(gh api --method POST "repos/$REPO/actions/runners/registration-token" --jq .token)"
    (cd "$dir" && ./config.sh --unattended --replace \
      --url "https://github.com/$REPO" --token "$tok" \
      --name "$(hostname)-basely-$n" --labels "$LABELS" --work _work) \
      || die "config.sh failed for runner $n"
  fi
  service_unit "$n" > "$UNIT_DIR/$(unit_name "$n")"
done

# Everything above touches only files, so it works over a non-session ssh. Everything below needs
# the systemd --user bus, which a bare ssh may not have; exit 4 rather than reporting success for a
# runner that will never pick up a job.
bus_ok=yes
systemctl --user daemon-reload 2>/dev/null || bus_ok=no
loginctl enable-linger "$USER" >/dev/null 2>&1 || true
for n in $(seq 1 "$INSTANCES"); do
  systemctl --user enable --now "$(unit_name "$n")" 2>/dev/null || bus_ok=no
done
if [ "$bus_ok" != yes ]; then
  echo "units written to $UNIT_DIR but the systemd --user bus was unreachable — no runner is supervised." >&2
  echo "finish at a console on this host: systemctl --user daemon-reload && systemctl --user enable --now $PREFIX-1.service" >&2
  exit 4
fi

check yes
