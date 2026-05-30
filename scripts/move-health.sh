#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
. "$ROOT/scripts/lib/move-guards.sh"

MOVE_HOST="${MOVE_HOST:-ableton@move.local}"
SCHWUNG_DIR="${SCHWUNG_DIR:-/data/UserData/schwung}"
MODULE_IDS="$(node scripts/module-targets.ts ids)"

usage() {
  cat <<EOF
Usage: $(basename "$0")

Check basic Ableton Move + Schwung deployment health over SSH.
Without MODULE_ID, checks every module. Set MODULE_ID=<id> to target one.

Environment:
  MOVE_HOST       SSH target (default: ableton@move.local)
  SCHWUNG_DIR     Schwung install dir (default: /data/UserData/schwung)
  MODULE_ID       optional module to check
  COMPONENT_TYPE  Schwung module kind directory override for single-module checks
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

if [ -n "${COMPONENT_TYPE:-}" ] && [ -z "${MODULE_ID:-}" ]; then
  echo "move-health: COMPONENT_TYPE override requires MODULE_ID=<id>" >&2
  exit 2
fi

component_dir_for() {
  local module_id="$1"
  if [ -n "${COMPONENT_TYPE:-}" ]; then
    echo "$COMPONENT_TYPE"
    return
  fi

  local module_kind
  module_kind="$(node scripts/module-targets.ts field "$module_id" componentType)"
  case "$module_kind" in
    sound_generator) echo "sound_generators" ;;
    audio_fx)        echo "audio_fx" ;;
    midi_fx)         echo "midi_fx" ;;
    *)
      echo "move-health: $module_id has unrecognized component_type='$module_kind'" >&2
      exit 2
      ;;
  esac
}

move_guard_validate_host "$MOVE_HOST"
move_guard_validate_schwung_dir "$SCHWUNG_DIR"
if [ -n "${COMPONENT_TYPE:-}" ]; then
  move_guard_validate_component_type "$COMPONENT_TYPE"
fi

echo "move-health: checking SSH to $MOVE_HOST"
ssh -o ConnectTimeout=5 -o BatchMode=yes "$MOVE_HOST" true

echo "move-health: checking Schwung paths"
ssh "$MOVE_HOST" "test -d '$SCHWUNG_DIR' && test -d '$SCHWUNG_DIR/modules'"

for MODULE_ID in $MODULE_IDS; do
  move_guard_validate_module_id "$MODULE_ID"
  COMPONENT_DIR="$(component_dir_for "$MODULE_ID")"
  move_guard_validate_component_type "$COMPONENT_DIR"
  REMOTE_MODULE_DIR="$SCHWUNG_DIR/modules/$COMPONENT_DIR/$MODULE_ID"

  echo "move-health: checking module path $REMOTE_MODULE_DIR"
  ssh "$MOVE_HOST" "test -d '$REMOTE_MODULE_DIR' && test -f '$REMOTE_MODULE_DIR/dsp.so' && test -f '$REMOTE_MODULE_DIR/module.json'"

  echo "move-health: [$MODULE_ID] remote module files"
  ssh "$MOVE_HOST" "ls -lh '$REMOTE_MODULE_DIR/dsp.so' '$REMOTE_MODULE_DIR/module.json' '$REMOTE_MODULE_DIR/ui.js' 2>/dev/null || true"
done

echo "move-health: disk space"
ssh "$MOVE_HOST" "df -h /data/UserData | awk 'NR==1 || NR==2 {print}'"

echo "move-health: Schwung debug logging"
ssh "$MOVE_HOST" "if [ -f '$SCHWUNG_DIR/debug_log_on' ]; then echo enabled; else echo disabled; fi"

echo "move-health: recent Schwung log"
ssh "$MOVE_HOST" "if [ -f '$SCHWUNG_DIR/debug.log' ]; then tail -20 '$SCHWUNG_DIR/debug.log'; else echo 'no debug.log'; fi"

echo "move-health: ok"
