#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

IMAGE_NAME="${IMAGE_NAME:-schwung-module-builder}"
MODULE_DIR="src/modules/westfold"

if [ -z "${CROSS_PREFIX:-}" ] && [ -z "${SCHWUNG_NO_DOCKER:-}" ] && [ ! -f "/.dockerenv" ]; then
  if command -v docker >/dev/null 2>&1; then
    if ! docker image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
      docker build -t "$IMAGE_NAME" -f scripts/Dockerfile .
    fi
    docker run --rm \
      -v "$ROOT:/build" \
      -u "$(id -u):$(id -g)" \
      -w /build \
      -e CROSS_PREFIX=aarch64-linux-gnu- \
      "$IMAGE_NAME" \
      ./scripts/build.sh
    exit 0
  fi
fi

CROSS_PREFIX="${CROSS_PREFIX:-aarch64-linux-gnu-}"
if ! command -v "${CROSS_PREFIX}gcc" >/dev/null 2>&1; then
  echo "Compiler ${CROSS_PREFIX}gcc not found."
  echo "Install an aarch64 Linux toolchain, install Docker, or run SCHWUNG_NO_DOCKER=1 ./scripts/build-host.sh for local-only experiments."
  exit 1
fi

mkdir -p build dist/westfold

"${CROSS_PREFIX}gcc" -std=c11 -O3 -g -shared -fPIC \
  "$MODULE_DIR/dsp/westfold.c" \
  "$MODULE_DIR/dsp/westfold_core.c" \
  -o build/dsp.so \
  -Isrc \
  -I"$MODULE_DIR/dsp" \
  -lm

cp "$MODULE_DIR/module.json" dist/westfold/module.json
cp "$MODULE_DIR/ui.js" dist/westfold/ui.js
cp build/dsp.so dist/westfold/dsp.so

(
  cd dist
  tar -czf westfold-module.tar.gz westfold
)

echo "Build complete: dist/westfold-module.tar.gz"
