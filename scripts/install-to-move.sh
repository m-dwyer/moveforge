#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODULE_ID="${MODULE_ID:-westfold}"
MOVE_HOST="${MOVE_HOST:-ableton@move.local}"
COMPONENT_TYPE="${COMPONENT_TYPE:-sound_generators}"
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
  COMPONENT_TYPE    Schwung modules subdir (default: sound_generators)
EOF
      exit 0
      ;;
    *)
      echo "unknown arg: $arg (try --help)" >&2
      exit 2
      ;;
  esac
done

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
ssh "$MOVE_HOST" "mkdir -p $REMOTE_DIR"
scp -r "dist/$MODULE_ID" "$MOVE_HOST:$REMOTE_DIR/"

# 6. Post-deploy probe
REMOTE_PATH="$REMOTE_DIR/$MODULE_ID/dsp.so"
REMOTE_SIZE=$(ssh "$MOVE_HOST" "stat -c %s $REMOTE_PATH 2>/dev/null || stat -f %z $REMOTE_PATH 2>/dev/null || echo 0")
if [ "$REMOTE_SIZE" != "$LOCAL_SIZE" ]; then
  echo "install-to-move: ERROR remote dsp.so size $REMOTE_SIZE != local $LOCAL_SIZE" >&2
  exit 1
fi

echo "install-to-move: installed $MODULE_ID to $MOVE_HOST:$REMOTE_PATH (${REMOTE_SIZE} bytes)"
