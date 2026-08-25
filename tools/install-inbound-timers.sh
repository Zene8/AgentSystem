#!/usr/bin/env bash
# install-inbound-timers.sh — install the inbound event-triage poller timers (#483, phase 4).
#
# One systemd --user timer per cadence tier, not per source. The spec requires:
#   fast:   2 min   (Gmail, Beeper)
#   medium: 10 min  (GitHub)
#   daily:  1x/day  (Notion)
#
# Each timer invokes `node tools/inbound/poll-run.js --cadence=<tier> --alert` with
# LIFE_REPO set in the environment. The tier a source runs in comes from the policy file,
# not from code, so retuning does not need a deploy.
#
# The interval for each tier is defined in tools/inbound/policy.js as CADENCE_INTERVAL_MS,
# and must not be changed without updating both sides.
#
# User units, not system units: no sudo, and LIFE_REPO is a user setting. Lingering is
# enabled so the timer keeps firing after logout — same as install-brain-sync-timer.sh.
#
#   bash tools/install-inbound-timers.sh              # install + start all three
#   bash tools/install-inbound-timers.sh --dry-run    # print the units, change nothing
#   bash tools/install-inbound-timers.sh --check      # exit 1 if any tier is drifted
#   bash tools/install-inbound-timers.sh --check-units # the same, minus liveness checks (tests)
#   bash tools/install-inbound-timers.sh --uninstall
#
# Install exit codes: 0 = all units written AND enabled/active. 4 = units written but
# systemd --user bus unreachable or enable failed (a human must finish at a console).
# 5 = $LIFE_REPO is unset, so nothing was written. Anything else non-zero means the units
# could not be written.
set -euo pipefail

UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
POLLER="$REPO_ROOT/tools/inbound/poll-run.js"
NODE_BIN="$(command -v node || echo /usr/bin/node)"

MODE="${1:-install}"

# Cadence tier definitions. The interval names come from systemd's OnUnitActiveSec.
# These MUST match tools/inbound/policy.js CADENCE_INTERVAL_MS.
declare -A TIERS=(
  [fast]="2min"
  [medium]="10min"
  [daily]="1d"
)

service_unit() {
  local tier="$1"
  cat <<UNIT
[Unit]
Description=Inbound event-triage poller for $tier tier (see #483)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=$REPO_ROOT
# PATH is set explicitly: a systemd user unit gets a minimal environment. Inheriting the
# caller's PATH makes this work where node came from nvm or a container.
# Quoted, and every % doubled: systemd reads % in a unit value as a specifier (%h, %i, %%…),
# so a PATH containing one — a Windows-style dir under WSL, a literal % in a name — either
# expands to something else or makes systemd reject the whole unit. Same treatment as
# brain-sync.service.
Environment="PATH=${PATH//%/%%}"
Environment="HOME=${HOME//%/%%}"
Environment="LIFE_REPO=${LIFE_REPO}"
ExecStart=$NODE_BIN $POLLER --cadence=$tier --alert
# 3 = an adapter or cursor failed and an alert was raised. That is the poller working as
# designed — hard stops are never silent — so systemd must not mark it failed. Same convention
# as brain-sync.service and actions-watchdog.service.
SuccessExitStatus=0 3
UNIT
}

timer_unit() {
  local tier="$1"
  local interval="${TIERS[$tier]}"
  cat <<UNIT
[Unit]
Description=Inbound event-triage poller timer for $tier tier (every $interval, see #483)

[Timer]
OnBootSec=1min
OnUnitActiveSec=$interval
# Catch up after the host was off. A machine that misses a polling cycle is a polling cycle
# during which events were not processed — and on a 2-minute timer, that can be visible.
Persistent=true

[Install]
WantedBy=timers.target
UNIT
}

check_poller_exists() {
  if [ ! -f "$POLLER" ]; then
    echo "poller script missing: $POLLER"
    return 1
  fi
  return 0
}

case "$MODE" in
  --uninstall)
    for tier in "${!TIERS[@]}"; do
      systemctl --user disable --now "inbound-poller-$tier.timer" 2>/dev/null || true
      rm -f "$UNIT_DIR/inbound-poller-$tier.service" "$UNIT_DIR/inbound-poller-$tier.timer"
    done
    systemctl --user daemon-reload 2>/dev/null || true
    echo "removed inbound-poller timers (fast, medium, daily)"
    exit 0
    ;;

  --dry-run)
    echo "would write units for three cadence tiers:"
    for tier in "${!TIERS[@]}"; do
      echo ""
      echo "would write $UNIT_DIR/inbound-poller-$tier.service:"; service_unit "$tier" | sed 's/^/  /'
      echo "would write $UNIT_DIR/inbound-poller-$tier.timer:"; timer_unit "$tier" | sed 's/^/  /'
    done
    echo ""
    echo "would run: loginctl enable-linger $(whoami)"
    echo "would run: systemctl --user daemon-reload && systemctl --user enable --now inbound-poller-{fast,medium,daily}.timer"
    exit 0
    ;;

  --check|--check-units)
    drift=0

    # Check the poller script exists first. If it does not, all three units are broken and we
    # should report that early rather than checking individual unit files.
    if ! check_poller_exists; then
      drift=1
    fi

    # The unit files carry LIFE_REPO in their environment; that's what matters.
    # We verify it below per-tier when checking each .service file.
    # Note: $LIFE_REPO in the current shell is irrelevant here — we check what was
    # baked into the units at install time.

    # Check each tier's unit pair.
    for tier in "${!TIERS[@]}"; do
      interval="${TIERS[$tier]}"
      svc="$UNIT_DIR/inbound-poller-$tier.service"
      tmr="$UNIT_DIR/inbound-poller-$tier.timer"

      if [ ! -f "$svc" ]; then
        echo "missing    $svc"; drift=1
      else
        exec_line="$(grep -m1 '^ExecStart=' "$svc" | cut -d= -f2- || true)"
        script_path="$(printf '%s\n' "$exec_line" | awk '{print $2}')"
        if [ -z "$script_path" ] || [ ! -f "$script_path" ]; then
          echo "drift      $svc runs a script that is not there: ${script_path:-<none>}"; drift=1
        elif ! grep -q '^SuccessExitStatus=0 3' "$svc"; then
          echo "drift      $svc lost SuccessExitStatus=0 3 — a raised failure alert would read as a unit failure"; drift=1
        elif ! grep -q '^Environment="LIFE_REPO=.' "$svc"; then
          echo "drift      $svc has no LIFE_REPO environment variable (or it is empty) — every adapter will fail"; drift=1
        else
          echo "in sync    $svc -> $script_path"
        fi
      fi

      if [ ! -f "$tmr" ]; then
        echo "missing    $tmr"; drift=1
      elif ! grep -q "^OnUnitActiveSec=$interval" "$tmr"; then
        echo "drift      $tmr has wrong interval (expected $interval)"; drift=1
      else
        echo "in sync    $tmr (every $interval)"
      fi
    done

    # Liveness check: only if the systemd bus is reachable (same reasoning as brain-sync-timer.sh).
    # --check-units skips this for tests.
    if [ "$MODE" = '--check-units' ]; then
      echo "skipped    timer liveness (--check-units)"
    elif systemctl --user list-timers --no-pager >/dev/null 2>&1; then
      all_active=1
      for tier in "${!TIERS[@]}"; do
        if systemctl --user is-active "inbound-poller-$tier.timer" >/dev/null 2>&1; then
          echo "active     inbound-poller-$tier.timer"
        else
          echo "INACTIVE   inbound-poller-$tier.timer — units are on disk but not running"
          drift=1
          all_active=0
        fi
      done
    else
      echo "unknown    cannot reach the user systemd bus — timer state not checked"
    fi

    exit "$drift"
    ;;

  install|"")
    # Fail early if $LIFE_REPO is unset, since every adapter will fail silently without it.
    if [ -z "${LIFE_REPO:-}" ]; then
      echo "error: \$LIFE_REPO is unset — set it to the Life OS checkout root before installing" >&2
      echo "example: export LIFE_REPO=/home/user/life" >&2
      exit 5
    fi

    # Verify the poller script exists.
    if ! check_poller_exists; then exit 1; fi

    mkdir -p "$UNIT_DIR"
    for tier in "${!TIERS[@]}"; do
      service_unit "$tier" > "$UNIT_DIR/inbound-poller-$tier.service"
      timer_unit "$tier"   > "$UNIT_DIR/inbound-poller-$tier.timer"
    done

    who="$(whoami)"
    # Best-effort. Report the outcome rather than swallowing it.
    if loginctl enable-linger "$who" 2>/dev/null; then
      echo "linger enabled for $who"
    else
      echo "  !! could not enable linger — the timers will stop at logout"
    fi

    # Guarded, not chained. Capture stderr so we can report it.
    bus_ok=1
    bus_err=""
    if ! bus_err="$(systemctl --user daemon-reload 2>&1)"; then
      bus_ok=0
    elif ! bus_err="$(systemctl --user enable --now inbound-poller-fast.timer inbound-poller-medium.timer inbound-poller-daily.timer 2>&1)"; then
      bus_ok=0
    fi

    if [ "$bus_ok" = 0 ]; then
      echo "units written to $UNIT_DIR/inbound-poller-{fast,medium,daily}.{service,timer} but NOT enabled — systemd --user is unreachable (or enable failed)" >&2
      echo "systemd said: ${bus_err:-<no output>}" >&2
      echo "a human must run this at a console: loginctl enable-linger $who && systemctl --user daemon-reload && systemctl --user enable --now inbound-poller-fast.timer inbound-poller-medium.timer inbound-poller-daily.timer" >&2
      exit 4
    fi

    echo "installed: inbound-poller timers (fast: every 2min, medium: every 10min, daily: 1x/day)"
    systemctl --user list-timers inbound-poller-fast.timer inbound-poller-medium.timer inbound-poller-daily.timer --no-pager
    ;;

  *)
    echo "unknown option: $MODE (try --dry-run, --check, --uninstall)" >&2
    exit 2
    ;;
esac
