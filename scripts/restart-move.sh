#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/move-guards.sh"

MOVE_HOST="${MOVE_HOST:-ableton@move.local}"
SCHWUNG_DIR="${SCHWUNG_DIR:-/data/UserData/schwung}"

usage() {
  cat <<EOF
Usage: $(basename "$0")

Ask the installed Schwung restart helper to restart Move.

Environment:
  MOVE_HOST    SSH target (default: ableton@move.local)
  SCHWUNG_DIR  Schwung install dir (default: /data/UserData/schwung)
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

move_guard_validate_host "$MOVE_HOST"
move_guard_validate_schwung_dir "$SCHWUNG_DIR"

ssh "$MOVE_HOST" "test -x '$SCHWUNG_DIR/restart-move.sh'"
ssh "$MOVE_HOST" "sh '$SCHWUNG_DIR/restart-move.sh'"
echo "restart-move: requested Move restart on $MOVE_HOST"
