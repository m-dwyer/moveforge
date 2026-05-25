#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODULE_ID="${MODULE_ID:-westfold}"
MODULE_DIR="src/modules/$MODULE_ID"

COMPONENT_TYPE="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$MODULE_DIR/module.json','utf8')).capabilities?.component_type ?? '')")"
if [ "$COMPONENT_TYPE" != "sound_generator" ]; then
  echo "[$MODULE_ID] skipping audio render: component_type='$COMPONENT_TYPE' (only sound_generator has an offline render path)" >&2
  exit 0
fi

mkdir -p build renders

cc -std=c11 -O2 -g \
  tools/render_wav.c \
  "$MODULE_DIR/dsp/$MODULE_ID.c" \
  "$MODULE_DIR/dsp/${MODULE_ID}_core.c" \
  -o "build/render_wav_$MODULE_ID" \
  -Isrc \
  -I"$MODULE_DIR/dsp" \
  -lm

"./build/render_wav_$MODULE_ID" "renders/$MODULE_ID-demo.wav"

if [ "${1:-}" = "--suite" ]; then
  rm -rf "renders/$MODULE_ID-suite"
  mkdir -p "renders/$MODULE_ID-suite"
  RENDER_BIN="./build/render_wav_$MODULE_ID" node scripts/render-suite.ts
fi
