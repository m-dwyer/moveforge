#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

IMAGE_NAME="${IMAGE_NAME:-schwung-module-builder}"
# Per-module source paths are resolved on the host (needs node) and written
# here, then read by the node-less cross-compile container via the mounted repo.
MANIFEST="build/module-manifest.tsv"

in_container() { [ -f "/.dockerenv" ]; }

if ! in_container; then
  # --- HOST ONLY: resolve the module work-list with node ---
  # The cross-compile container has NO JS runtime, so every `node` call must
  # happen here. Resolve an ABSOLUTE node path: bare `node` can be shadowed by a
  # broken shim earlier on PATH under make (reports "command not found" even
  # though `command -v node` resolves), and an absolute path sidesteps that.
  NODE="$(command -v node 2>/dev/null || true)"
  if [ -z "$NODE" ] || [ ! -x "$NODE" ]; then
    NODE=""
    if command -v mise >/dev/null 2>&1; then
      _d="$(mise where node 2>/dev/null || true)"
      [ -n "$_d" ] && [ -x "$_d/bin/node" ] && NODE="$_d/bin/node"
    fi
    if [ -z "$NODE" ]; then
      _root="${MISE_DATA_DIR:-$HOME/.local/share/mise}/installs/node"
      for _d in "$_root/lts/bin" "$_root"/*/bin; do
        [ -x "$_d/node" ] && NODE="$_d/node" && break
      done
    fi
  fi
  if [ -z "$NODE" ] || [ ! -x "$NODE" ]; then
    echo "build.sh: could not find a usable node on the host (checked PATH and mise installs)" >&2
    exit 1
  fi

  module_target() { "$NODE" scripts/module-target.ts "$@"; }

  if [ -n "${MODULE_ID:-}" ]; then
    MODULE_IDS="$MODULE_ID"
  else
    MODULE_IDS="$(module_target ids)"
  fi

  mkdir -p build
  : > "$MANIFEST"
  for m in $MODULE_IDS; do
    printf '%s\t%s\t%s\t%s\n' "$m" \
      "$(module_target module-dir "$m")" \
      "$(module_target core-impl "$m")" \
      "$(module_target wrapper-c "$m")" >> "$MANIFEST"
  done

  # --- Cross-compile in Docker when available (unless told not to) ---
  if [ -z "${CROSS_PREFIX:-}" ] && [ -z "${SCHWUNG_NO_DOCKER:-}" ]; then
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
fi

# --- COMPILE (host with a toolchain, or inside the container) ---
CROSS_PREFIX="${CROSS_PREFIX:-aarch64-linux-gnu-}"
if ! command -v "${CROSS_PREFIX}gcc" >/dev/null 2>&1; then
  echo "Compiler ${CROSS_PREFIX}gcc not found."
  echo "Install an aarch64 Linux toolchain, install Docker, or run SCHWUNG_NO_DOCKER=1 ./scripts/build-host.sh for local-only experiments."
  exit 1
fi

if [ ! -f "$MANIFEST" ]; then
  echo "build.sh: missing $MANIFEST (host module resolution did not run)" >&2
  exit 1
fi

mkdir -p build

while IFS=$'\t' read -r MODULE_ID MODULE_DIR CORE_IMPL WRAPPER_C; do
  if [ -z "${MODULE_ID:-}" ]; then continue; fi
  mkdir -p "dist/$MODULE_ID"

  # Move is a Raspberry Pi CM4: BCM2711, 4x Cortex-A72 @ 1.5 GHz. The build was
  # generic ARMv8 baseline with no tuning at all. -march stays at the baseline so
  # the .so keeps running anywhere ARMv8, while -mtune lets the scheduler assume
  # an out-of-order 3-wide A72 rather than a conservative default. Matches what
  # schwung's own build notes use.
  "${CROSS_PREFIX}gcc" -std=c11 -O3 -g -Wall -Wextra -march=armv8-a -mtune=cortex-a72 -shared -fPIC \
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
done < "$MANIFEST"
