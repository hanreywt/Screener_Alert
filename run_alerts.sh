#!/usr/bin/env bash
# Run the S/R alert engine unattended — survives terminal close, keeps the
# Mac awake so alerts keep firing to Discord while you're away.
#
#   ./run_alerts.sh          # start in the background
#   ./run_alerts.sh stop     # stop it
#   ./run_alerts.sh status   # is it running? tail the log
#   ./run_alerts.sh log      # follow the live log
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY="$DIR/.venv/bin/python"
LOG="$DIR/alerts.log"
PIDFILE="$DIR/.alerts.pid"

cmd="${1:-start}"

case "$cmd" in
  start)
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      echo "Already running (PID $(cat "$PIDFILE")). Use './run_alerts.sh stop' first."
      exit 1
    fi
    if [ ! -f "$DIR/.env" ]; then
      echo "⚠  No .env found. Copy .env.example to .env and set DISCORD_WEBHOOK_URL."
      exit 1
    fi
    # caffeinate -i keeps the system awake while the engine runs; nohup +
    # background detaches it from this terminal.
    nohup caffeinate -i "$PY" "$DIR/engine.py" >> "$LOG" 2>&1 &
    echo $! > "$PIDFILE"
    echo "✅ Alert engine started (PID $!). Logging to $LOG"
    echo "   Stop with: ./run_alerts.sh stop"
    ;;
  stop)
    if [ -f "$PIDFILE" ]; then
      kill "$(cat "$PIDFILE")" 2>/dev/null || true
      rm -f "$PIDFILE"
      echo "🛑 Stopped."
    else
      echo "Not running (no pidfile)."
    fi
    ;;
  status)
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      echo "✅ Running (PID $(cat "$PIDFILE")). Last lines:"
      tail -n 15 "$LOG" 2>/dev/null || true
    else
      echo "🛑 Not running."
    fi
    ;;
  log)
    tail -f "$LOG"
    ;;
  *)
    echo "Usage: ./run_alerts.sh [start|stop|status|log]"
    exit 1
    ;;
esac
