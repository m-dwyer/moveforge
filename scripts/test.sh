#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
. "$ROOT/scripts/lib/module-targets.sh"

MODULE_IDS="$(moveforge_module_ids)"
mkdir -p build

for MODULE_ID in $MODULE_IDS; do
  MODULE_DIR="$(moveforge_module_dir "$MODULE_ID")"
  CORE_IMPL="$(moveforge_core_impl "$MODULE_ID")"
  WRAPPER_C="$(moveforge_wrapper_c "$MODULE_ID")"
  TEST_CORE_C="$(moveforge_test_core_c "$MODULE_ID")"
  TEST_PLUGIN_C="$(moveforge_test_plugin_c "$MODULE_ID")"
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
