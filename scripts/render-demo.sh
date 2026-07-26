#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

module_target() {
  node scripts/module-target.ts "$@"
}

MODULE_IDS="$(module_target ids)"

mkdir -p build renders

for MODULE_ID in $MODULE_IDS; do
  MODULE_DIR="$(module_target module-dir "$MODULE_ID")"
  COMPONENT_TYPE="$(module_target component-type "$MODULE_ID")"
  CORE_IMPL="$(module_target core-impl "$MODULE_ID")"
  WRAPPER_C="$(module_target wrapper-c "$MODULE_ID")"
  RENDER_BIN="$(module_target render-bin "$MODULE_ID")"
  RENDER_DEMO_OUT="$(module_target render-demo-out "$MODULE_ID")"

  case "$COMPONENT_TYPE" in
    sound_generator)
      cc -std=c11 -O2 -g -DMOVEFORGE_COUNT_NONFINITE \
        tools/render_wav.c \
        "$WRAPPER_C" \
        "$CORE_IMPL" \
        -o "$RENDER_BIN" \
        -Isrc \
        -I"$MODULE_DIR/dsp" \
        -lm

      "$RENDER_BIN" "$RENDER_DEMO_OUT"

      if [ "${1:-}" = "--suite" ]; then
        rm -rf "renders/$MODULE_ID-suite"
        mkdir -p "renders/$MODULE_ID-suite"
        MODULE_ID="$MODULE_ID" RENDER_BIN="$RENDER_BIN" node scripts/render-suite.ts
      elif [ "${1:-}" = "--stress" ]; then
        rm -rf "renders/$MODULE_ID-stress"
        mkdir -p "renders/$MODULE_ID-stress"
        MODULE_ID="$MODULE_ID" RENDER_BIN="$RENDER_BIN" node scripts/render-stress.ts
      fi
      ;;

    audio_fx)
      cc -std=c11 -O2 -g -DMOVEFORGE_COUNT_NONFINITE \
        tools/render_fx.c \
        "$WRAPPER_C" \
        "$CORE_IMPL" \
        -o "$RENDER_BIN" \
        -Isrc \
        -I"$MODULE_DIR/dsp" \
        -lm

      "$RENDER_BIN" "$RENDER_DEMO_OUT"

      if [ "${1:-}" = "--suite" ]; then
        rm -rf "renders/$MODULE_ID-suite"
        mkdir -p "renders/$MODULE_ID-suite"
        MODULE_ID="$MODULE_ID" RENDER_BIN="$RENDER_BIN" RENDER_KIND=audio_fx node scripts/render-suite.ts
      elif [ "${1:-}" = "--stress" ]; then
        rm -rf "renders/$MODULE_ID-stress"
        mkdir -p "renders/$MODULE_ID-stress"
        MODULE_ID="$MODULE_ID" RENDER_BIN="$RENDER_BIN" RENDER_KIND=audio_fx node scripts/render-stress.ts
      fi
      ;;

    midi_fx)
      cc -std=c11 -O2 -g -DMOVEFORGE_COUNT_NONFINITE \
        tools/trace_midi_fx.c \
        "$WRAPPER_C" \
        "$CORE_IMPL" \
        -o "$RENDER_BIN" \
        -Isrc \
        -I"$MODULE_DIR/dsp" \
        -lm

      "$RENDER_BIN" "$RENDER_DEMO_OUT"

      if [ "${1:-}" = "--suite" ]; then
        rm -rf "renders/$MODULE_ID-suite"
        mkdir -p "renders/$MODULE_ID-suite"
        MODULE_ID="$MODULE_ID" RENDER_BIN="$RENDER_BIN" RENDER_KIND=midi_fx node scripts/render-suite.ts
      fi
      ;;

    *)
      echo "[$MODULE_ID] skipping render: component_type='$COMPONENT_TYPE' (no offline harness for this kind)" >&2
      ;;
  esac
done
