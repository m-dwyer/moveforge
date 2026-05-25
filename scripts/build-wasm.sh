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

# Shared deps that invalidate every Schwung-wrapper build.
SHARED_SCHWUNG_DEPS=(
  "src/host/schwung_wasm_glue.c"
  "src/host/plugin_api_v1.h"
)

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

# Collect emcc commands for all modules that need (re)building.
COMMANDS=()
SUMMARY=()

component_type_of() {
  node -e "console.log(JSON.parse(require('fs').readFileSync('$1','utf8')).capabilities?.component_type ?? '')"
}

# mf_* WASM ABI shared by sound_generator and audio_fx. Sound generators
# don't use the input pointers but exporting them lets the worklet use one
# code path. audio_fx wrappers pass them to process_float.
MF_BASE_EXPORTS='_mf_init,_mf_set_param,_mf_in_left_ptr,_mf_in_right_ptr,_mf_left_ptr,_mf_right_ptr,_mf_render'
MF_SG_EXPORTS=',_mf_note_on,_mf_note_off,_mf_all_notes_off,_mf_set_pitch_bend'

for MODULE_ID in $MODULE_IDS; do
  MODULE_DIR="src/modules/$MODULE_ID"
  WASM_OUT="web/wasm/${MODULE_ID}.wasm"
  SCH_OUT="web/wasm/${MODULE_ID}-schwung.wasm"

  COMPONENT_TYPE="$(component_type_of "$MODULE_DIR/module.json")"
  case "$COMPONENT_TYPE" in
    sound_generator|audio_fx) ;;
    *)
      SUMMARY+=("skip   $MODULE_ID (component_type=$COMPONENT_TYPE — no WASM path)")
      continue
      ;;
  esac

  WASM_DEPS=(
    "$MODULE_DIR/dsp/${MODULE_ID}_wasm.c"
    "$MODULE_DIR/dsp/${MODULE_ID}_core.c"
    "$MODULE_DIR/dsp/${MODULE_ID}_core.h"
  )

  if [ "$COMPONENT_TYPE" = "sound_generator" ]; then
    MF_EXPORTS="${MF_BASE_EXPORTS}${MF_SG_EXPORTS}"
  else
    MF_EXPORTS="${MF_BASE_EXPORTS}"
  fi
  EXPORT_LIST="$(printf '"%s"' "${MF_EXPORTS//,/\",\"}")"

  if needs_rebuild "$WASM_OUT" "${WASM_DEPS[@]}"; then
    COMMANDS+=("emcc '$MODULE_DIR/dsp/${MODULE_ID}_wasm.c' '$MODULE_DIR/dsp/${MODULE_ID}_core.c' -O3 -I'$MODULE_DIR/dsp' -s STANDALONE_WASM=1 -s EXPORTED_FUNCTIONS='[$EXPORT_LIST]' -Wl,--no-entry -o '$WASM_OUT'")
    SUMMARY+=("build  $WASM_OUT")
  else
    SUMMARY+=("cached $WASM_OUT")
  fi

  # Schwung-wrapped WASM only builds for sound_generator today (different ABI for audio_fx).
  if [ "$COMPONENT_TYPE" = "sound_generator" ]; then
    SCH_DEPS=(
      "$MODULE_DIR/dsp/${MODULE_ID}.c"
      "$MODULE_DIR/dsp/${MODULE_ID}_core.c"
      "$MODULE_DIR/dsp/${MODULE_ID}_core.h"
      "${SHARED_SCHWUNG_DEPS[@]}"
    )
    if needs_rebuild "$SCH_OUT" "${SCH_DEPS[@]}"; then
      COMMANDS+=("emcc '$MODULE_DIR/dsp/${MODULE_ID}.c' '$MODULE_DIR/dsp/${MODULE_ID}_core.c' 'src/host/schwung_wasm_glue.c' -O3 -I'$MODULE_DIR/dsp' -Isrc -s STANDALONE_WASM=1 -s EXPORTED_FUNCTIONS='[\"_sch_init\",\"_sch_set_param\",\"_sch_midi\",\"_sch_render\",\"_sch_left_ptr\",\"_sch_right_ptr\",\"_sch_key_buf\",\"_sch_val_buf\",\"_sch_key_buf_size\",\"_sch_val_buf_size\"]' -Wl,--no-entry -o '$SCH_OUT'")
      SUMMARY+=("build  $SCH_OUT")
    else
      SUMMARY+=("cached $SCH_OUT")
    fi
  fi
done

if [ "${#COMMANDS[@]}" -eq 0 ]; then
  printf '%s\n' "${SUMMARY[@]}"
  echo "All WASM artifacts up to date."
  exit 0
fi

# Join with && so a single container builds everything sequentially.
JOINED="$(printf '%s && ' "${COMMANDS[@]}")true"

docker run --rm \
  -v "$ROOT:/src" \
  -u "$(id -u):$(id -g)" \
  -w /src \
  "$IMAGE_NAME" \
  sh -c "$JOINED"

printf '%s\n' "${SUMMARY[@]}"
