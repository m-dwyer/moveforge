#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -n "${MODULE_ID:-}" ]; then
  MODULE_IDS="$MODULE_ID"
else
  MODULE_IDS="$(find src/modules -mindepth 1 -maxdepth 1 -type d ! -name '_*' -exec basename {} \; | sort)"
fi
mkdir -p build

for MODULE_ID in $MODULE_IDS; do
  MODULE_DIR="src/modules/$MODULE_ID"
  if [ -f "$MODULE_DIR/dsp/$MODULE_ID.dsp" ]; then
    CORE_IMPL="$MODULE_DIR/dsp/${MODULE_ID}_adapter.c"
  else
    CORE_IMPL="$MODULE_DIR/dsp/${MODULE_ID}_core.c"
  fi
  cc -std=c11 -O2 -g \
    "tests/test_${MODULE_ID}_core.c" \
    "$CORE_IMPL" \
    -o "build/test_${MODULE_ID}_core" \
    -Isrc \
    -I"$MODULE_DIR/dsp" \
    -lm

  "./build/test_${MODULE_ID}_core"
done
