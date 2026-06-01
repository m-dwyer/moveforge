#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

module_target() {
  node scripts/module-target.ts "$@"
}

MODULE_IDS="$(module_target ids)"
mkdir -p build

for MODULE_ID in $MODULE_IDS; do
  MODULE_DIR="$(module_target module-dir "$MODULE_ID")"
  CORE_IMPL="$(module_target core-impl "$MODULE_ID")"
  WRAPPER_C="$(module_target wrapper-c "$MODULE_ID")"
  TEST_CORE_C="$(module_target test-core-c "$MODULE_ID")"
  TEST_PLUGIN_C="$(module_target test-plugin-c "$MODULE_ID")"
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
