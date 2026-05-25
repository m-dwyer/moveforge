#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

IMAGE_NAME="${EMSCRIPTEN_IMAGE:-emscripten/emsdk:3.1.74}"
mkdir -p web/wasm

if [ -n "${MODULE_ID:-}" ]; then
  MODULE_IDS="$MODULE_ID"
else
  MODULE_IDS="$(find src/modules -mindepth 1 -maxdepth 1 -type d ! -name '_*' -exec basename {} \; | sort)"
fi

for MODULE_ID in $MODULE_IDS; do
  MODULE_DIR="src/modules/$MODULE_ID"
  docker run --rm \
    -v "$ROOT:/src" \
    -u "$(id -u):$(id -g)" \
    -w /src \
    "$IMAGE_NAME" \
    emcc "$MODULE_DIR/dsp/${MODULE_ID}_wasm.c" \
      "$MODULE_DIR/dsp/${MODULE_ID}_core.c" \
      -O3 \
      -I"$MODULE_DIR/dsp" \
      -s STANDALONE_WASM=1 \
      -s EXPORTED_FUNCTIONS='["_mf_init","_mf_set_param","_mf_note_on","_mf_note_off","_mf_all_notes_off","_mf_set_pitch_bend","_mf_left_ptr","_mf_right_ptr","_mf_render"]' \
      -Wl,--no-entry \
      -o "web/wasm/$MODULE_ID.wasm"

  echo "Built web/wasm/$MODULE_ID.wasm"
done
