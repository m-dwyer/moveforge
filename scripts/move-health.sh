#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/move-guards.sh"

MOVE_HOST="${MOVE_HOST:-ableton@move.local}"
SCHWUNG_DIR="${SCHWUNG_DIR:-/data/UserData/schwung}"
MODULE_ID="${MODULE_ID:-westfold}"
COMPONENT_TYPE="${COMPONENT_TYPE:-sound_generators}"
REMOTE_MODULE_DIR="$SCHWUNG_DIR/modules/$COMPONENT_TYPE/$MODULE_ID"

usage() {
  cat <<EOF
Usage: $(basename "$0")

Check basic Ableton Move + Schwung deployment health over SSH.

Environment:
  MOVE_HOST       SSH target (default: ableton@move.local)
  SCHWUNG_DIR     Schwung install dir (default: /data/UserData/schwung)
  MODULE_ID       module to check (default: westfold)
  COMPONENT_TYPE  Schwung module kind directory (default: sound_generators)
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

move_guard_validate_host "$MOVE_HOST"
move_guard_validate_schwung_dir "$SCHWUNG_DIR"
move_guard_validate_module_id "$MODULE_ID"
move_guard_validate_component_type "$COMPONENT_TYPE"

echo "move-health: checking SSH to $MOVE_HOST"
ssh -o ConnectTimeout=5 -o BatchMode=yes "$MOVE_HOST" true

echo "move-health: checking Schwung paths"
ssh "$MOVE_HOST" "test -d '$SCHWUNG_DIR' && test -d '$SCHWUNG_DIR/modules' && test -d '$SCHWUNG_DIR/modules/$COMPONENT_TYPE'"

echo "move-health: checking module path $REMOTE_MODULE_DIR"
ssh "$MOVE_HOST" "test -d '$REMOTE_MODULE_DIR' && test -f '$REMOTE_MODULE_DIR/dsp.so' && test -f '$REMOTE_MODULE_DIR/module.json'"

echo "move-health: remote module files"
ssh "$MOVE_HOST" "ls -lh '$REMOTE_MODULE_DIR/dsp.so' '$REMOTE_MODULE_DIR/module.json' '$REMOTE_MODULE_DIR/ui.js' 2>/dev/null || true"

echo "move-health: disk space"
ssh "$MOVE_HOST" "df -h /data/UserData | awk 'NR==1 || NR==2 {print}'"

echo "move-health: Schwung debug logging"
ssh "$MOVE_HOST" "if [ -f '$SCHWUNG_DIR/debug_log_on' ]; then echo enabled; else echo disabled; fi"

echo "move-health: recent Schwung log"
ssh "$MOVE_HOST" "if [ -f '$SCHWUNG_DIR/debug.log' ]; then tail -20 '$SCHWUNG_DIR/debug.log'; else echo 'no debug.log'; fi"

echo "move-health: ok"
