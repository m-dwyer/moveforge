#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/move-guards.sh"

MOVE_HOST="${MOVE_HOST:-ableton@move.local}"
SCHWUNG_DIR="${SCHWUNG_DIR:-/data/UserData/schwung}"
PURGE_DOWNLOAD_CACHE=0
DRY_RUN=1
YES=0

usage() {
  cat <<EOF
Usage: $(basename "$0") [--apply] [--yes] [--purge-download-cache]

Clear transient Schwung/Move runtime cache files over SSH.

This script is dry-run by default. Without --apply it only prints the exact
remote paths it would clear. Pass --apply to delete selected transient files.
Pass --purge-download-cache to also clear \$SCHWUNG_DIR/cache.

Environment:
  MOVE_HOST    SSH target (default: ableton@move.local)
  SCHWUNG_DIR  Schwung install dir (default: /data/UserData/schwung)
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --apply) DRY_RUN=0 ;;
    --yes) YES=1 ;;
    --purge-download-cache) PURGE_DOWNLOAD_CACHE=1 ;;
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

REMOTE_PLAN="
set -eu
echo 'would remove: /dev/shm/move-shadow-*'
echo 'would remove: /dev/shm/move-display-*'
echo 'would remove contents of: $SCHWUNG_DIR/tmp/'
if [ '$PURGE_DOWNLOAD_CACHE' = '1' ]; then
  echo 'would remove contents of: $SCHWUNG_DIR/cache/'
fi
"

if [ "$DRY_RUN" = "1" ]; then
  ssh "$MOVE_HOST" "$REMOTE_PLAN"
  echo "clear-move-cache: dry run only; pass --apply to delete"
  exit 0
fi

if [ "$YES" != "1" ]; then
  move_guard_confirm "Delete transient Schwung cache files on $MOVE_HOST?"
fi

REMOTE_SCRIPT="
set -eu
test -d '$SCHWUNG_DIR'
test -d '$SCHWUNG_DIR/tmp' || mkdir -p '$SCHWUNG_DIR/tmp'
find /dev/shm -maxdepth 1 -type s \\( -name 'move-shadow-*' -o -name 'move-display-*' \\) -print -delete 2>/dev/null || true
find '$SCHWUNG_DIR/tmp' -mindepth 1 -maxdepth 1 -print -exec rm -rf -- {} \\;
if [ '$PURGE_DOWNLOAD_CACHE' = '1' ]; then
  test -d '$SCHWUNG_DIR/cache' || mkdir -p '$SCHWUNG_DIR/cache'
  find '$SCHWUNG_DIR/cache' -mindepth 1 -maxdepth 1 -print -exec rm -rf -- {} \\;
fi
"

ssh "$MOVE_HOST" "$REMOTE_SCRIPT"
echo "clear-move-cache: cleared selected transient caches on $MOVE_HOST"
