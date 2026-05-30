#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODULE_IDS="$(node scripts/module-targets.ts ids)"
mkdir -p build-host

for MODULE_ID in $MODULE_IDS; do
  MODULE_DIR="$(node scripts/module-targets.ts field "$MODULE_ID" moduleDir)"
  CORE_IMPL="$(node scripts/module-targets.ts field "$MODULE_ID" coreImpl)"
  WRAPPER_C="$(node scripts/module-targets.ts field "$MODULE_ID" wrapperC)"
  HOST_SO="build-host/${MODULE_ID}-dsp.so"
  mkdir -p "dist-host/$MODULE_ID"

  cc -std=c11 -O3 -g -shared -fPIC \
    "$WRAPPER_C" \
    "$CORE_IMPL" \
    -o "$HOST_SO" \
    -Isrc \
    -I"$MODULE_DIR/dsp" \
    -lm

  cp "$MODULE_DIR/module.json" "dist-host/$MODULE_ID/module.json"
  cp "$MODULE_DIR/ui.js" "dist-host/$MODULE_ID/ui.js"
  cp "$HOST_SO" "dist-host/$MODULE_ID/dsp.so"

  echo "Host-only build complete: dist-host/$MODULE_ID"
done
