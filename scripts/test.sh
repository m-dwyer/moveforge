#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODULE_IDS="$(node scripts/module-targets.ts ids)"
mkdir -p build

for MODULE_ID in $MODULE_IDS; do
  MODULE_DIR="$(node scripts/module-targets.ts field "$MODULE_ID" moduleDir)"
  CORE_IMPL="$(node scripts/module-targets.ts field "$MODULE_ID" coreImpl)"
  WRAPPER_C="$(node scripts/module-targets.ts field "$MODULE_ID" wrapperC)"
  TEST_CORE_C="$(node scripts/module-targets.ts field "$MODULE_ID" testCoreC)"
  TEST_PLUGIN_C="$(node scripts/module-targets.ts field "$MODULE_ID" testPluginC)"
  cc -std=c11 -O2 -g \
    "$TEST_CORE_C" \
    "$CORE_IMPL" \
    -o "build/test_${MODULE_ID}_core" \
    -Isrc \
    -I"$MODULE_DIR/dsp" \
    -lm

  "./build/test_${MODULE_ID}_core"

  if [ -f "$TEST_PLUGIN_C" ]; then
    cc -std=c11 -O2 -g \
      "$TEST_PLUGIN_C" \
      "$WRAPPER_C" \
      "$CORE_IMPL" \
      -o "build/test_${MODULE_ID}_plugin" \
      -Isrc \
      -I"$MODULE_DIR/dsp" \
      -lm

    "./build/test_${MODULE_ID}_plugin"
  fi
done
