#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
. "$ROOT/scripts/lib/module-targets.sh"

MODULE_IDS="$(moveforge_module_ids)"

mkdir -p build renders

for MODULE_ID in $MODULE_IDS; do
  MODULE_DIR="$(moveforge_module_dir "$MODULE_ID")"
  COMPONENT_TYPE="$(moveforge_component_type "$MODULE_ID")"
  CORE_IMPL="$(moveforge_core_impl "$MODULE_ID")"
  WRAPPER_C="$(moveforge_wrapper_c "$MODULE_ID")"
  RENDER_BIN="$(moveforge_render_bin "$MODULE_ID" "$COMPONENT_TYPE")"
  RENDER_DEMO_OUT="$(moveforge_render_demo_out "$MODULE_ID" "$COMPONENT_TYPE")"

  case "$COMPONENT_TYPE" in
    sound_generator)
      cc -std=c11 -O2 -g \
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
      cc -std=c11 -O2 -g \
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
      cc -std=c11 -O2 -g \
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
