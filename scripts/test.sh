#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODULE_DIR="src/modules/westfold"
mkdir -p build

cc -std=c11 -O2 -g \
  tests/test_westfold_core.c \
  "$MODULE_DIR/dsp/westfold_core.c" \
  -o build/test_westfold_core \
  -I"$MODULE_DIR/dsp" \
  -lm

./build/test_westfold_core
