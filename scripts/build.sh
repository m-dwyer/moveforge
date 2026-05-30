#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

IMAGE_NAME="${IMAGE_NAME:-schwung-module-builder}"
if [ -n "${MODULE_ID:-}" ]; then
  MODULE_IDS="$MODULE_ID"
else
  if command -v node >/dev/null 2>&1; then
    MODULE_IDS="$(node scripts/module-targets.ts ids)"
  else
    MODULE_IDS="$(find src/modules -mindepth 1 -maxdepth 1 -type d ! -name '_*' -exec basename {} \; | sort)"
  fi
fi

if [ -z "${CROSS_PREFIX:-}" ] && [ -z "${SCHWUNG_NO_DOCKER:-}" ] && [ ! -f "/.dockerenv" ]; then
  if command -v docker >/dev/null 2>&1; then
    if ! docker image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
      docker build -t "$IMAGE_NAME" -f scripts/Dockerfile .
    fi
    DOCKER_ENV=(-e CROSS_PREFIX=aarch64-linux-gnu-)
    if [ -n "${MODULE_ID:-}" ]; then
      DOCKER_ENV+=(-e "MODULE_ID=$MODULE_ID")
    fi
    docker run --rm \
      -v "$ROOT:/build" \
      -u "$(id -u):$(id -g)" \
      -w /build \
      "${DOCKER_ENV[@]}" \
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

mkdir -p build

for MODULE_ID in $MODULE_IDS; do
  if command -v node >/dev/null 2>&1; then
    MODULE_DIR="$(node scripts/module-targets.ts field "$MODULE_ID" moduleDir)"
    CORE_IMPL="$(node scripts/module-targets.ts field "$MODULE_ID" coreImpl)"
    WRAPPER_C="$(node scripts/module-targets.ts field "$MODULE_ID" wrapperC)"
  else
    MODULE_DIR="src/modules/$MODULE_ID"
    WRAPPER_C="$MODULE_DIR/dsp/$MODULE_ID.c"
    if [ -f "$MODULE_DIR/dsp/$MODULE_ID.dsp" ]; then
      CORE_IMPL="$MODULE_DIR/dsp/${MODULE_ID}_adapter.c"
    else
      CORE_IMPL="$MODULE_DIR/dsp/${MODULE_ID}_core.c"
    fi
  fi
  mkdir -p "dist/$MODULE_ID"

  "${CROSS_PREFIX}gcc" -std=c11 -O3 -g -shared -fPIC \
    "$WRAPPER_C" \
    "$CORE_IMPL" \
    -o "build/${MODULE_ID}-dsp.so" \
    -Isrc \
    -I"$MODULE_DIR/dsp" \
    -lm

  cp "$MODULE_DIR/module.json" "dist/$MODULE_ID/module.json"
  cp "$MODULE_DIR/ui.js" "dist/$MODULE_ID/ui.js"
  # Ship the shared library under two names. The synth chain host dlopens
  # "<module>/dsp.so"; the audio-FX chain host hardcodes "<module>/<id>.so"
  # (chain_host.c load_audio_fx, ignoring module.json's "dsp"). Shipping both
  # satisfies whichever path the host uses for this module's kind.
  cp "build/${MODULE_ID}-dsp.so" "dist/$MODULE_ID/dsp.so"
  cp "build/${MODULE_ID}-dsp.so" "dist/$MODULE_ID/${MODULE_ID}.so"
  [ -f "$MODULE_DIR/ui_chain.js" ] && cp "$MODULE_DIR/ui_chain.js" "dist/$MODULE_ID/ui_chain.js"
  [ -f "$MODULE_DIR/presets.json" ] && cp "$MODULE_DIR/presets.json" "dist/$MODULE_ID/presets.json"

  (
    cd dist
    tar -czf "$MODULE_ID-module.tar.gz" "$MODULE_ID"
  )

  echo "Build complete: dist/$MODULE_ID-module.tar.gz"
done
