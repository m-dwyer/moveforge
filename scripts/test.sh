#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODULE_IDS="${MODULE_ID:-westfold dustline}"
mkdir -p build

for MODULE_ID in $MODULE_IDS; do
  MODULE_DIR="src/modules/$MODULE_ID"
  cc -std=c11 -O2 -g \
    "tests/test_${MODULE_ID}_core.c" \
    "$MODULE_DIR/dsp/${MODULE_ID}_core.c" \
    -o "build/test_${MODULE_ID}_core" \
    -I"$MODULE_DIR/dsp" \
    -lm

  "./build/test_${MODULE_ID}_core"
done
