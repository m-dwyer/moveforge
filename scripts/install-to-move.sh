#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

./scripts/build.sh

DEST="${MOVE_HOST:-ableton@move.local}:/data/UserData/schwung/modules/sound_generators/"
ssh "${MOVE_HOST:-ableton@move.local}" "mkdir -p /data/UserData/schwung/modules/sound_generators"
scp -r dist/westfold "$DEST"

echo "Installed westfold to ${DEST}"

