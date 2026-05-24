#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

IMAGE_NAME="${EMSCRIPTEN_IMAGE:-emscripten/emsdk:3.1.74}"
MODULE_DIR="src/modules/westfold"
mkdir -p web/wasm

docker run --rm \
  -v "$ROOT:/src" \
  -u "$(id -u):$(id -g)" \
  -w /src \
  "$IMAGE_NAME" \
  emcc "$MODULE_DIR/dsp/westfold_wasm.c" \
    "$MODULE_DIR/dsp/westfold_core.c" \
    -O3 \
    -I"$MODULE_DIR/dsp" \
    -s STANDALONE_WASM=1 \
    -s EXPORTED_FUNCTIONS='["_wf_init","_wf_set_param","_wf_note_on","_wf_note_off","_wf_all_notes_off","_wf_set_pitch_bend","_wf_left_ptr","_wf_right_ptr","_wf_render"]' \
    -Wl,--no-entry \
    -o web/wasm/westfold.wasm

echo "Built web/wasm/westfold.wasm"
