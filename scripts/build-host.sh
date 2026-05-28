#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODULE_ID="${MODULE_ID:-westfold}"
MODULE_DIR="src/modules/$MODULE_ID"
mkdir -p build-host "dist-host/$MODULE_ID"

# Faust-backed modules implement the core API via `<id>_adapter.c` (which
# #includes the generated `<id>_faust.c`); plain-C modules via `<id>_core.c`.
# Detect by presence of `<id>.dsp`.
if [ -f "$MODULE_DIR/dsp/${MODULE_ID}.dsp" ]; then
  CORE_IMPL="$MODULE_DIR/dsp/${MODULE_ID}_adapter.c"
else
  CORE_IMPL="$MODULE_DIR/dsp/${MODULE_ID}_core.c"
fi

cc -std=c11 -O3 -g -shared -fPIC \
  "$MODULE_DIR/dsp/$MODULE_ID.c" \
  "$CORE_IMPL" \
  -o build-host/dsp.so \
  -Isrc \
  -I"$MODULE_DIR/dsp" \
  -lm

cp "$MODULE_DIR/module.json" "dist-host/$MODULE_ID/module.json"
cp "$MODULE_DIR/ui.js" "dist-host/$MODULE_ID/ui.js"
cp build-host/dsp.so "dist-host/$MODULE_ID/dsp.so"

echo "Host-only build complete: dist-host/$MODULE_ID"
