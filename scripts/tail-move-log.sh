#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/move-guards.sh"

MOVE_HOST="${MOVE_HOST:-ableton@move.local}"
SCHWUNG_DIR="${SCHWUNG_DIR:-/data/UserData/schwung}"
LOG_FILE="$SCHWUNG_DIR/debug.log"
FOLLOW=1
LINES=80
ENABLE=0
CLEAR=0
YES=0

usage() {
  cat <<EOF
Usage: $(basename "$0") [--enable] [--clear] [--yes] [--no-follow] [--lines N]

Tail Schwung's unified debug log on Ableton Move.

Environment:
  MOVE_HOST    SSH target (default: ableton@move.local)
  SCHWUNG_DIR  Schwung install dir (default: /data/UserData/schwung)
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --enable) ENABLE=1 ;;
    --clear) CLEAR=1 ;;
    --yes) YES=1 ;;
    --no-follow) FOLLOW=0 ;;
    --lines)
      shift
      LINES="${1:?--lines requires a number}"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown arg: $1 (try --help)" >&2
      exit 2
      ;;
  esac
  shift
done

move_guard_validate_host "$MOVE_HOST"
move_guard_validate_schwung_dir "$SCHWUNG_DIR"
move_guard_validate_positive_int "--lines" "$LINES"

if [ "$ENABLE" = "1" ]; then
  ssh "$MOVE_HOST" "mkdir -p '$SCHWUNG_DIR' && touch '$SCHWUNG_DIR/debug_log_on'"
fi

if [ "$CLEAR" = "1" ]; then
  if [ "$YES" != "1" ]; then
    move_guard_confirm "Truncate Schwung debug log at $LOG_FILE on $MOVE_HOST?"
  fi
  ssh "$MOVE_HOST" ": > '$LOG_FILE'"
fi

if [ "$FOLLOW" = "1" ]; then
  ssh -t "$MOVE_HOST" "touch '$LOG_FILE' && tail -n '$LINES' -f '$LOG_FILE'"
else
  ssh "$MOVE_HOST" "if [ -f '$LOG_FILE' ]; then tail -n '$LINES' '$LOG_FILE'; else echo 'no debug.log'; fi"
fi
