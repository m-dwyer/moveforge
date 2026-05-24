#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODULE_DIR="src/modules/westfold"
mkdir -p build renders

cc -std=c11 -O2 -g \
  tools/render_wav.c \
  "$MODULE_DIR/dsp/westfold.c" \
  "$MODULE_DIR/dsp/westfold_core.c" \
  -o build/render_wav \
  -Isrc \
  -I"$MODULE_DIR/dsp" \
  -lm

./build/render_wav renders/westfold-demo.wav

if [ "${1:-}" = "--suite" ]; then
  mkdir -p renders/westfold-suite
  node scripts/render-suite.mjs
fi
