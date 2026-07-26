#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

module_target() {
  node scripts/module-target.ts "$@"
}

IMAGE_NAME="${EMSCRIPTEN_IMAGE:-emscripten/emsdk:3.1.74}"
mkdir -p web/wasm

if [ -n "${MODULE_ID:-}" ]; then
  MODULE_IDS="$MODULE_ID"
else
  MODULE_IDS="$(module_target ids)"
fi

FORCE="${FORCE:-0}"

# Shared deps that invalidate every WASM build. These must cover everything the
# compiled translation unit #includes, plus what those files are generated from.
# An omission here is a correctness bug, not a speed one: the build prints
# "cached", the browser keeps the old .wasm, and e.g. a newly added param's
# <id>_param_id() still returns -1, so the knob silently does nothing.
SHARED_DEPS_COMMON=(
  "src/modules/_shared/mf_dsp.h"
  "src/modules/_shared/scope.h"
  "src/host/faust_adapter.h"
)
SHARED_DEPS_SG=(
  "src/host/schwung_wasm_glue_sg.c"
  "src/host/plugin_api_v1.h"
  "src/modules/_shared/dsp_runtime.h"
  "${SHARED_DEPS_COMMON[@]}"
)
SHARED_DEPS_FX=(
  "src/host/schwung_wasm_glue_fx.c"
  "src/host/audio_fx_api_v2.h"
  "src/host/plugin_api_v1.h"
  "src/modules/_shared/dsp_runtime.h"
  "${SHARED_DEPS_COMMON[@]}"
)
SHARED_DEPS_MIDI_FX=(
  "src/host/midi_fx_wasm_glue.c"
  "src/host/midi_fx_api_v1.h"
  "src/host/plugin_api_v1.h"
  "${SHARED_DEPS_COMMON[@]}"
)

# Shared sch_* ABI. sg uses a subset (note handlers via sch_midi); both
# expose sch_in_* so the worklet can use one input-feed code path.
SCH_EXPORTS='_sch_init,_sch_set_param,_sch_midi,_sch_render,_sch_in_left_ptr,_sch_in_right_ptr,_sch_left_ptr,_sch_right_ptr,_sch_key_buf,_sch_val_buf,_sch_key_buf_size,_sch_val_buf_size'

# midi_fx ABI. No audio I/O. Inbound MIDI via mf_process_midi_byte; periodic
# emit via mf_tick. Both return emitted count; bytes are read from mf_out_buf_ptr
# (3 bytes per message, status/d1/d2).
MF_EXPORTS='_mf_init,_mf_set_param,_mf_process_midi_byte,_mf_tick,_mf_out_buf_ptr,_mf_out_buf_size,_mf_key_buf,_mf_val_buf,_mf_key_buf_size,_mf_val_buf_size'

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
  MODULE_DIR="$(module_target module-dir "$MODULE_ID")"
  WASM_OUT="web/wasm/${MODULE_ID}.wasm"
  COMPONENT_TYPE="$(module_target component-type "$MODULE_ID")"
  CORE_IMPL="$(module_target core-impl "$MODULE_ID")"
  WRAPPER_C="$(module_target wrapper-c "$MODULE_ID")"
  CORE_HEADER="$(module_target core-header "$MODULE_ID")"
  FAUST_C="$(module_target faust-c "$MODULE_ID")"
  # Generated files #included into the TU, and the sources they are generated
  # from. needs_rebuild skips any that do not exist for this module.
  MODULE_DEPS=(
    "$MODULE_DIR/module.json"
    "$MODULE_DIR/presets.json"
    "$MODULE_DIR/dsp/${MODULE_ID}.dsp"
    "$MODULE_DIR/dsp/${MODULE_ID}_params.gen.h"
    "$MODULE_DIR/dsp/${MODULE_ID}_params.gen.inc"
    "$MODULE_DIR/dsp/${MODULE_ID}_presets.gen.inc"
    "$MODULE_DIR/dsp/${MODULE_ID}_scope.gen.inc"
  )
  case "$COMPONENT_TYPE" in
    sound_generator)
      GLUE="src/host/schwung_wasm_glue_sg.c"
      EXPORTS="$SCH_EXPORTS"
      DEPS=(
        "$WRAPPER_C"
        "$CORE_IMPL"
        "$CORE_HEADER"
        "$FAUST_C"
        "${SHARED_DEPS_SG[@]}"
        "${MODULE_DEPS[@]}"
      )
      ;;
    audio_fx)
      GLUE="src/host/schwung_wasm_glue_fx.c"
      EXPORTS="$SCH_EXPORTS"
      DEPS=(
        "$WRAPPER_C"
        "$CORE_IMPL"
        "$CORE_HEADER"
        "$FAUST_C"
        "${SHARED_DEPS_FX[@]}"
        "${MODULE_DEPS[@]}"
      )
      ;;
    midi_fx)
      GLUE="src/host/midi_fx_wasm_glue.c"
      EXPORTS="$MF_EXPORTS"
      DEPS=(
        "$WRAPPER_C"
        "$CORE_IMPL"
        "$CORE_HEADER"
        "$FAUST_C"
        "${SHARED_DEPS_MIDI_FX[@]}"
        "${MODULE_DEPS[@]}"
      )
      ;;
    *)
      SUMMARY+=("skip   $MODULE_ID (component_type=$COMPONENT_TYPE — no WASM path)")
      continue
      ;;
  esac

  if needs_rebuild "$WASM_OUT" "${DEPS[@]}"; then
    COMMANDS+=("emcc -Wall -Wextra '$WRAPPER_C' '$CORE_IMPL' '$GLUE' -O3 -I'$MODULE_DIR/dsp' -Isrc -s STANDALONE_WASM=1 -s EXPORTED_FUNCTIONS='[\"${EXPORTS//,/\",\"}\"]' -Wl,--no-entry -o '$WASM_OUT'")
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
