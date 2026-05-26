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

FORCE="${FORCE:-0}"

# Shared deps that invalidate every WASM build.
SHARED_DEPS_SG=(
  "src/host/schwung_wasm_glue_sg.c"
  "src/host/plugin_api_v1.h"
)
SHARED_DEPS_FX=(
  "src/host/schwung_wasm_glue_fx.c"
  "src/host/audio_fx_api_v2.h"
  "src/host/plugin_api_v1.h"
)
SHARED_DEPS_MIDI_FX=(
  "src/host/midi_fx_wasm_glue.c"
  "src/host/midi_fx_api_v1.h"
  "src/host/plugin_api_v1.h"
)

# Shared sch_* ABI. sg uses a subset (note handlers via sch_midi); both
# expose sch_in_* so the worklet can use one input-feed code path.
SCH_EXPORTS='_sch_init,_sch_set_param,_sch_midi,_sch_render,_sch_in_left_ptr,_sch_in_right_ptr,_sch_left_ptr,_sch_right_ptr,_sch_key_buf,_sch_val_buf,_sch_key_buf_size,_sch_val_buf_size'

# midi_fx ABI. No audio I/O. Inbound MIDI via mf_process_midi_byte; periodic
# emit via mf_tick. Both return emitted count; bytes are read from mf_out_buf_ptr
# (3 bytes per message, status/d1/d2).
MF_EXPORTS='_mf_init,_mf_set_param,_mf_process_midi_byte,_mf_tick,_mf_out_buf_ptr,_mf_out_buf_size,_mf_key_buf,_mf_val_buf,_mf_key_buf_size,_mf_val_buf_size'

component_type_of() {
  node -e "console.log(JSON.parse(require('fs').readFileSync('$1','utf8')).capabilities?.component_type ?? '')"
}

needs_rebuild() {
  local out="$1"; shift
  [ "$FORCE" = "1" ] && return 0
  [ -f "$out" ] || return 0
  local dep
  for dep in "$@"; do
    [ -f "$dep" ] || continue
    [ "$dep" -nt "$out" ] && return 0
  done
  return 1
}

COMMANDS=()
SUMMARY=()

for MODULE_ID in $MODULE_IDS; do
  MODULE_DIR="src/modules/$MODULE_ID"
  WASM_OUT="web/wasm/${MODULE_ID}.wasm"

  COMPONENT_TYPE="$(component_type_of "$MODULE_DIR/module.json")"
  case "$COMPONENT_TYPE" in
    sound_generator)
      GLUE="src/host/schwung_wasm_glue_sg.c"
      EXPORTS="$SCH_EXPORTS"
      DEPS=(
        "$MODULE_DIR/dsp/${MODULE_ID}.c"
        "$MODULE_DIR/dsp/${MODULE_ID}_core.c"
        "$MODULE_DIR/dsp/${MODULE_ID}_core.h"
        "${SHARED_DEPS_SG[@]}"
      )
      ;;
    audio_fx)
      GLUE="src/host/schwung_wasm_glue_fx.c"
      EXPORTS="$SCH_EXPORTS"
      DEPS=(
        "$MODULE_DIR/dsp/${MODULE_ID}.c"
        "$MODULE_DIR/dsp/${MODULE_ID}_core.c"
        "$MODULE_DIR/dsp/${MODULE_ID}_core.h"
        "${SHARED_DEPS_FX[@]}"
      )
      ;;
    midi_fx)
      GLUE="src/host/midi_fx_wasm_glue.c"
      EXPORTS="$MF_EXPORTS"
      DEPS=(
        "$MODULE_DIR/dsp/${MODULE_ID}.c"
        "$MODULE_DIR/dsp/${MODULE_ID}_core.c"
        "$MODULE_DIR/dsp/${MODULE_ID}_core.h"
        "${SHARED_DEPS_MIDI_FX[@]}"
      )
      ;;
    *)
      SUMMARY+=("skip   $MODULE_ID (component_type=$COMPONENT_TYPE — no WASM path)")
      continue
      ;;
  esac

  if needs_rebuild "$WASM_OUT" "${DEPS[@]}"; then
    COMMANDS+=("emcc '$MODULE_DIR/dsp/${MODULE_ID}.c' '$MODULE_DIR/dsp/${MODULE_ID}_core.c' '$GLUE' -O3 -I'$MODULE_DIR/dsp' -Isrc -s STANDALONE_WASM=1 -s EXPORTED_FUNCTIONS='[\"${EXPORTS//,/\",\"}\"]' -Wl,--no-entry -o '$WASM_OUT'")
    SUMMARY+=("build  $WASM_OUT")
  else
    SUMMARY+=("cached $WASM_OUT")
  fi
done

if [ "${#COMMANDS[@]}" -eq 0 ]; then
  printf '%s\n' "${SUMMARY[@]}"
  echo "All WASM artifacts up to date."
  exit 0
fi

JOINED="$(printf '%s && ' "${COMMANDS[@]}")true"

docker run --rm \
  -v "$ROOT:/src" \
  -u "$(id -u):$(id -g)" \
  -w /src \
  "$IMAGE_NAME" \
  sh -c "$JOINED"

printf '%s\n' "${SUMMARY[@]}"
