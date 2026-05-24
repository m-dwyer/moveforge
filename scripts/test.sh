#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

mkdir -p build

cc -std=c11 -O2 -g \
  tests/test_westfold_core.c \
  src/dsp/westfold_core.c \
  -o build/test_westfold_core \
  -Isrc/dsp \
  -lm

./build/test_westfold_core
