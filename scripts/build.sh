#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

IMAGE_NAME="${IMAGE_NAME:-schwung-module-builder}"
MODULE_ID="${MODULE_ID:-westfold}"
MODULE_DIR="src/modules/$MODULE_ID"

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
      -e MODULE_ID="$MODULE_ID" \
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

mkdir -p build "dist/$MODULE_ID"

"${CROSS_PREFIX}gcc" -std=c11 -O3 -g -shared -fPIC \
  "$MODULE_DIR/dsp/$MODULE_ID.c" \
  "$MODULE_DIR/dsp/${MODULE_ID}_core.c" \
  -o build/dsp.so \
  -Isrc \
  -I"$MODULE_DIR/dsp" \
  -lm

cp "$MODULE_DIR/module.json" "dist/$MODULE_ID/module.json"
cp "$MODULE_DIR/ui.js" "dist/$MODULE_ID/ui.js"
cp build/dsp.so "dist/$MODULE_ID/dsp.so"

(
  cd dist
  tar -czf "$MODULE_ID-module.tar.gz" "$MODULE_ID"
)

echo "Build complete: dist/$MODULE_ID-module.tar.gz"
