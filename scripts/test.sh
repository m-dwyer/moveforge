#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

module_target() {
  node scripts/module-target.ts "$@"
}

MODULE_IDS="$(module_target ids)"
mkdir -p build

# Shared DSP blocks (src/modules/_shared) are module-independent, so they are
# tested once rather than per module.
for SHARED_TEST in tests/test_mf_dsp.c; do
  SHARED_NAME="$(basename "$SHARED_TEST" .c)"
  cc -std=c11 -O2 -g \
    "$SHARED_TEST" \
    -o "build/${SHARED_NAME}" \
    -Isrc \
    -lm

  "./build/${SHARED_NAME}"
done

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
