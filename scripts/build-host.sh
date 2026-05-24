#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

mkdir -p build-host dist-host/westfold

cc -std=c11 -O3 -g -shared -fPIC \
  src/dsp/westfold.c \
  src/dsp/westfold_core.c \
  -o build-host/dsp.so \
  -Isrc \
  -lm

cp src/module.json dist-host/westfold/module.json
cp src/ui.js dist-host/westfold/ui.js
cp build-host/dsp.so dist-host/westfold/dsp.so

echo "Host-only build complete: dist-host/westfold"
