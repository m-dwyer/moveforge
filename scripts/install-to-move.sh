#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
. "$ROOT/scripts/lib/move-guards.sh"

MODULE_IDS="$(node scripts/module-targets.ts ids)"
MOVE_HOST="${MOVE_HOST:-ableton@move.local}"
FORCE=0
SKIP_BUILD=0

for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    -h|--help)
      cat <<EOF
Usage: $(basename "$0") [--force] [--skip-build]

Build (unless --skip-build) and install module(s) to \$MOVE_HOST.
Without MODULE_ID, installs every module. Set MODULE_ID=<id> to target one.

Pre-flight checks (any failure aborts unless --force):
  * dist/<id>/dsp.so must be aarch64
  * \$MOVE_HOST must be reachable over SSH
  * remote module partition must have at least 10 MiB free

After scp, each installed dsp.so size on the device is verified against the local file.

Environment:
  MODULE_ID         optional module directory under src/modules/
  MOVE_HOST         SSH target (default: ableton@move.local)
  COMPONENT_TYPE    Schwung modules subdir override for single-module installs.
                    Auto-inferred from src/modules/\$MODULE_ID/module.json by default.
EOF
      exit 0
      ;;
    *)
      echo "unknown arg: $arg (try --help)" >&2
      exit 2
      ;;
  esac
done

if [ -n "${COMPONENT_TYPE:-}" ] && [ -z "${MODULE_ID:-}" ]; then
  echo "install-to-move: COMPONENT_TYPE override requires MODULE_ID=<id>" >&2
  exit 2
fi

move_guard_validate_host "$MOVE_HOST"
if [ -n "${COMPONENT_TYPE:-}" ]; then
  move_guard_validate_component_type "$COMPONENT_TYPE"
fi

fail() {
  echo "install-to-move: $1" >&2
  if [ "$FORCE" = "1" ]; then
    echo "  (continuing because --force was passed)" >&2
  else
    echo "  re-run with --force to override" >&2
    exit 1
  fi
}

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
      echo "install-to-move: $module_id has unrecognized component_type='$module_kind'" >&2
      exit 2
      ;;
  esac
}

echo "install-to-move: checking SSH to $MOVE_HOST"
if ! ssh -o ConnectTimeout=5 -o BatchMode=yes "$MOVE_HOST" true 2>/dev/null; then
  fail "cannot SSH to $MOVE_HOST (key-based auth must be set up)"
fi

FREE_KB=$(ssh "$MOVE_HOST" "df -P /data/UserData | awk 'NR==2 {print \$4}'" 2>/dev/null || echo 0)
FREE_MB=$(( FREE_KB / 1024 ))
if [ "$FREE_MB" -lt 10 ]; then
  fail "/data/UserData has only ${FREE_MB} MiB free on $MOVE_HOST (need >= 10 MiB)"
fi
echo "install-to-move: $MOVE_HOST /data/UserData has ${FREE_MB} MiB free"

for MODULE_ID in $MODULE_IDS; do
  move_guard_validate_module_id "$MODULE_ID"
  COMPONENT_DIR="$(component_dir_for "$MODULE_ID")"
  move_guard_validate_component_type "$COMPONENT_DIR"
  REMOTE_DIR="/data/UserData/schwung/modules/$COMPONENT_DIR"

  if [ "$SKIP_BUILD" = "1" ]; then
    if [ ! -f "dist/$MODULE_ID/dsp.so" ]; then
      echo "install-to-move: --skip-build set but dist/$MODULE_ID/dsp.so is missing" >&2
      exit 1
    fi
  else
    MODULE_ID="$MODULE_ID" ./scripts/build.sh
  fi

  LOCAL_SO="dist/$MODULE_ID/dsp.so"
  ARCH=$(file -b "$LOCAL_SO" 2>/dev/null || echo unknown)
  case "$ARCH" in
    *aarch64*|*ARM\ aarch64*) ;;
    *) fail "dist/$MODULE_ID/dsp.so is not aarch64 (file says: $ARCH)" ;;
  esac

  LOCAL_SIZE=$(wc -c <"$LOCAL_SO" | tr -d ' ')
  echo "install-to-move: [$MODULE_ID] local dsp.so ${LOCAL_SIZE} bytes ($ARCH)"

  ssh "$MOVE_HOST" "test -d /data/UserData/schwung && mkdir -p '$REMOTE_DIR'"
  scp -r "dist/$MODULE_ID" "$MOVE_HOST:$REMOTE_DIR/"

  REMOTE_PATH="$REMOTE_DIR/$MODULE_ID/dsp.so"
  REMOTE_SIZE=$(ssh "$MOVE_HOST" "stat -c %s '$REMOTE_PATH' 2>/dev/null || stat -f %z '$REMOTE_PATH' 2>/dev/null || echo 0")
  if [ "$REMOTE_SIZE" != "$LOCAL_SIZE" ]; then
    echo "install-to-move: ERROR [$MODULE_ID] remote dsp.so size $REMOTE_SIZE != local $LOCAL_SIZE" >&2
    exit 1
  fi

  echo "install-to-move: installed $MODULE_ID to $MOVE_HOST:$REMOTE_PATH (${REMOTE_SIZE} bytes)"
done
