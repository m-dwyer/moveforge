#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
. "$ROOT/scripts/lib/move-guards.sh"

module_target() {
  node scripts/module-target.ts "$@"
}

MODULE_IDS="$(module_target ids)"
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

Files are staged to a temporary directory on the device and renamed into place,
so a shared object the host currently has dlopen'd is never truncated.

After install, every shipped file is verified against the local build by
checksum — not just dsp.so, since the chain host loads audio FX from <id>/<id>.so.

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

  module_target device-component-dir "$module_id"
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

# Agree on a checksum both ends can compute. The device is busybox-ish and macOS
# ships shasum/md5 rather than the GNU *sum names, so neither side can assume.
# Output is normalised to "<hash> <path>" with awk, since md5(1) prints one
# space and the *sum tools print two.
SUM_ALGO=""
REMOTE_SUM=""
LOCAL_SUM=()
for algo in sha256 md5; do
  case "$algo" in
    sha256) remote_try="sha256sum"; local_try="sha256sum shasum" ;;
    md5)    remote_try="md5sum";    local_try="md5sum md5" ;;
  esac
  ssh "$MOVE_HOST" "command -v $remote_try >/dev/null 2>&1" || continue
  for candidate in $local_try; do
    command -v "$candidate" >/dev/null 2>&1 || continue
    case "$candidate" in
      shasum) LOCAL_SUM=(shasum -a 256) ;;
      md5)    LOCAL_SUM=(md5 -r) ;;
      *)      LOCAL_SUM=("$candidate") ;;
    esac
    break
  done
  [ "${#LOCAL_SUM[@]}" -gt 0 ] || continue
  SUM_ALGO="$algo"
  REMOTE_SUM="$remote_try"
  break
done
[ -n "$SUM_ALGO" ] || fail "no checksum tool available on both this machine and $MOVE_HOST — cannot verify the install"

# "<hash> <path>" per file, sorted. Normalised with awk because md5(1) prints one
# space and the *sum tools print two.
manifest_local() {
  (cd "$1" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 "${LOCAL_SUM[@]}" | awk '{print $1, $NF}')
}
manifest_remote() {
  ssh "$MOVE_HOST" "cd '$1' && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 $REMOTE_SUM" | awk '{print $1, $NF}'
}

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

  TARGET_DIR="$REMOTE_DIR/$MODULE_ID"
  STAGE_DIR="$REMOTE_DIR/.$MODULE_ID.incoming"

  # Stage, then rename into place. A plain `scp` over the live directory
  # rewrites each file in place, and the host may have the .so dlopen'd
  # (chain_host.c:415 for sound generators, :243 for audio FX) — truncating a
  # mapping that is PROT_EXEC inside the audio callback. `mv` is a rename: it
  # is atomic and leaves the old inode intact for anything still holding it,
  # so a running instance keeps working until it is reloaded.
  ssh "$MOVE_HOST" "test -d /data/UserData/schwung && rm -rf '$STAGE_DIR' && mkdir -p '$STAGE_DIR' '$TARGET_DIR'"
  scp -r "dist/$MODULE_ID/." "$MOVE_HOST:$STAGE_DIR/"
  ssh "$MOVE_HOST" "cd '$STAGE_DIR' && find . -type f | while read -r f; do
      mkdir -p \"$TARGET_DIR/\$(dirname \"\$f\")\"
      mv -f \"\$f\" \"$TARGET_DIR/\$f\"
    done; cd / && rm -rf '$STAGE_DIR'"

  # Verify every shipped file, not just dsp.so. The chain host loads audio FX
  # from <id>/<id>.so, so for an FX module dsp.so was never the file that
  # mattered — and module.json, ui.js, ui_chain.js and presets.json were never
  # checked at all.
  EXPECTED_FILES=$(find "dist/$MODULE_ID" -type f | wc -l | tr -d ' ')
  MANIFEST_LOCAL="$(manifest_local "dist/$MODULE_ID")"
  MANIFEST_REMOTE="$(manifest_remote "$TARGET_DIR")"

  # Guard the comparison itself: if a checksum command fails, both sides come
  # back empty and an equality test would pass vacuously — a check that cannot
  # fail is worse than no check.
  LOCAL_LINES=$(printf '%s\n' "$MANIFEST_LOCAL" | grep -c . || true)
  if [ "$EXPECTED_FILES" -eq 0 ] || [ "$LOCAL_LINES" != "$EXPECTED_FILES" ]; then
    echo "install-to-move: ERROR [$MODULE_ID] could not checksum the local build" \
         "($LOCAL_LINES of $EXPECTED_FILES files hashed with $SUM_ALGO)" >&2
    exit 1
  fi

  if [ "$MANIFEST_LOCAL" != "$MANIFEST_REMOTE" ]; then
    echo "install-to-move: ERROR [$MODULE_ID] installed files do not match the local build" >&2
    diff <(printf '%s\n' "$MANIFEST_LOCAL") <(printf '%s\n' "$MANIFEST_REMOTE") >&2 || true
    exit 1
  fi

  echo "install-to-move: installed $MODULE_ID to $MOVE_HOST:$TARGET_DIR"
  echo "install-to-move: [$MODULE_ID] verified $LOCAL_LINES file(s) by $SUM_ALGO"
done
