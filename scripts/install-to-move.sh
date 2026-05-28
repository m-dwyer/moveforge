#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
. "$ROOT/scripts/lib/move-guards.sh"

MODULE_ID="${MODULE_ID:-westfold}"
MOVE_HOST="${MOVE_HOST:-ableton@move.local}"

# COMPONENT_TYPE picks the Schwung modules subdir on the device. By default
# we read it from src/modules/$MODULE_ID/module.json so the right path is
# used for sound generators, audio FX, and MIDI FX. Override by setting
# COMPONENT_TYPE explicitly if you need to.
if [ -z "${COMPONENT_TYPE:-}" ]; then
  MODULE_JSON="src/modules/$MODULE_ID/module.json"
  if [ ! -f "$MODULE_JSON" ]; then
    echo "install-to-move: $MODULE_JSON not found; cannot infer COMPONENT_TYPE" >&2
    echo "  pass COMPONENT_TYPE=sound_generators|audio_fx|midi_fx explicitly" >&2
    exit 2
  fi
  MODULE_KIND="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$MODULE_JSON','utf8')).capabilities?.component_type ?? '')")"
  case "$MODULE_KIND" in
    sound_generator) COMPONENT_TYPE="sound_generators" ;;
    audio_fx)        COMPONENT_TYPE="audio_fx" ;;
    midi_fx)         COMPONENT_TYPE="midi_fx" ;;
    *)
      echo "install-to-move: $MODULE_JSON has unrecognized component_type='$MODULE_KIND'" >&2
      echo "  pass COMPONENT_TYPE=sound_generators|audio_fx|midi_fx explicitly" >&2
      exit 2
      ;;
  esac
fi
REMOTE_DIR="/data/UserData/schwung/modules/$COMPONENT_TYPE"
FORCE=0
SKIP_BUILD=0

for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    -h|--help)
      cat <<EOF
Usage: $(basename "$0") [--force] [--skip-build]

Build (unless --skip-build) and install module \$MODULE_ID to \$MOVE_HOST.

Pre-flight checks (any failure aborts unless --force):
  * git working tree must be clean
  * dist/\$MODULE_ID/dsp.so must be aarch64
  * \$MOVE_HOST must be reachable over SSH
  * remote \$REMOTE_DIR partition must have at least 10 MiB free

After scp, the installed dsp.so size on the device is verified against the local file.

Environment:
  MODULE_ID         module directory under src/modules/ (default: westfold)
  MOVE_HOST         SSH target (default: ableton@move.local)
  COMPONENT_TYPE    Schwung modules subdir. Auto-inferred from
                    src/modules/\$MODULE_ID/module.json by default; override
                    if needed.
EOF
      exit 0
      ;;
    *)
      echo "unknown arg: $arg (try --help)" >&2
      exit 2
      ;;
  esac
done

move_guard_validate_module_id "$MODULE_ID"
move_guard_validate_component_type "$COMPONENT_TYPE"
move_guard_validate_host "$MOVE_HOST"

fail() {
  echo "install-to-move: $1" >&2
  if [ "$FORCE" = "1" ]; then
    echo "  (continuing because --force was passed)" >&2
  else
    echo "  re-run with --force to override" >&2
    exit 1
  fi
}

# 1. Clean working tree
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  fail "git working tree has uncommitted changes; deploys should map to a known commit"
fi

# 2. Build (or skip)
if [ "$SKIP_BUILD" = "1" ]; then
  if [ ! -f "dist/$MODULE_ID/dsp.so" ]; then
    echo "install-to-move: --skip-build set but dist/$MODULE_ID/dsp.so is missing" >&2
    exit 1
  fi
else
  MODULE_ID="$MODULE_ID" ./scripts/build.sh
fi

# 3. Arch sanity
LOCAL_SO="dist/$MODULE_ID/dsp.so"
ARCH=$(file -b "$LOCAL_SO" 2>/dev/null || echo unknown)
case "$ARCH" in
  *aarch64*|*ARM\ aarch64*) ;;
  *) fail "dist/$MODULE_ID/dsp.so is not aarch64 (file says: $ARCH)" ;;
esac

LOCAL_SIZE=$(wc -c <"$LOCAL_SO" | tr -d ' ')
echo "install-to-move: local dsp.so ${LOCAL_SIZE} bytes ($ARCH)"

# 4. SSH reachability + free space
if ! ssh -o ConnectTimeout=5 -o BatchMode=yes "$MOVE_HOST" true 2>/dev/null; then
  fail "cannot SSH to $MOVE_HOST (key-based auth must be set up)"
fi

FREE_KB=$(ssh "$MOVE_HOST" "df -P /data/UserData | awk 'NR==2 {print \$4}'" 2>/dev/null || echo 0)
FREE_MB=$(( FREE_KB / 1024 ))
if [ "$FREE_MB" -lt 10 ]; then
  fail "/data/UserData has only ${FREE_MB} MiB free on $MOVE_HOST (need >= 10 MiB)"
fi
echo "install-to-move: $MOVE_HOST /data/UserData has ${FREE_MB} MiB free"

# 5. Copy
ssh "$MOVE_HOST" "test -d /data/UserData/schwung && mkdir -p '$REMOTE_DIR'"
scp -r "dist/$MODULE_ID" "$MOVE_HOST:$REMOTE_DIR/"

# 6. Post-deploy probe
REMOTE_PATH="$REMOTE_DIR/$MODULE_ID/dsp.so"
REMOTE_SIZE=$(ssh "$MOVE_HOST" "stat -c %s '$REMOTE_PATH' 2>/dev/null || stat -f %z '$REMOTE_PATH' 2>/dev/null || echo 0")
if [ "$REMOTE_SIZE" != "$LOCAL_SIZE" ]; then
  echo "install-to-move: ERROR remote dsp.so size $REMOTE_SIZE != local $LOCAL_SIZE" >&2
  exit 1
fi

echo "install-to-move: installed $MODULE_ID to $MOVE_HOST:$REMOTE_PATH (${REMOTE_SIZE} bytes)"
