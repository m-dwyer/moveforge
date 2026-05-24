#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODULE_DIR="src/modules/westfold"
mkdir -p build-host dist-host/westfold

cc -std=c11 -O3 -g -shared -fPIC \
  "$MODULE_DIR/dsp/westfold.c" \
  "$MODULE_DIR/dsp/westfold_core.c" \
  -o build-host/dsp.so \
  -Isrc \
  -I"$MODULE_DIR/dsp" \
  -lm

cp "$MODULE_DIR/module.json" dist-host/westfold/module.json
cp "$MODULE_DIR/ui.js" dist-host/westfold/ui.js
cp build-host/dsp.so dist-host/westfold/dsp.so

echo "Host-only build complete: dist-host/westfold"
