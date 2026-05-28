#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODULE_ID="${MODULE_ID:-westfold}"
MODULE_DIR="src/modules/$MODULE_ID"

COMPONENT_TYPE="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$MODULE_DIR/module.json','utf8')).capabilities?.component_type ?? '')")"

# Faust-backed modules implement the core API via `<id>_adapter.c`; plain-C
# modules implement it in `<id>_core.c`. Detect by presence of `<id>.dsp`.
if [ -f "$MODULE_DIR/dsp/$MODULE_ID.dsp" ]; then
  CORE_IMPL="$MODULE_DIR/dsp/${MODULE_ID}_adapter.c"
else
  CORE_IMPL="$MODULE_DIR/dsp/${MODULE_ID}_core.c"
fi

mkdir -p build renders

case "$COMPONENT_TYPE" in
  sound_generator)
    cc -std=c11 -O2 -g \
      tools/render_wav.c \
      "$MODULE_DIR/dsp/$MODULE_ID.c" \
      "$CORE_IMPL" \
      -o "build/render_wav_$MODULE_ID" \
      -Isrc \
      -I"$MODULE_DIR/dsp" \
      -lm

    "./build/render_wav_$MODULE_ID" "renders/$MODULE_ID-demo.wav"

    if [ "${1:-}" = "--suite" ]; then
      rm -rf "renders/$MODULE_ID-suite"
      mkdir -p "renders/$MODULE_ID-suite"
      RENDER_BIN="./build/render_wav_$MODULE_ID" node scripts/render-suite.ts
    elif [ "${1:-}" = "--stress" ]; then
      rm -rf "renders/$MODULE_ID-stress"
      mkdir -p "renders/$MODULE_ID-stress"
      RENDER_BIN="./build/render_wav_$MODULE_ID" node scripts/render-stress.ts
    fi
    ;;

  audio_fx)
    cc -std=c11 -O2 -g \
      tools/render_fx.c \
      "$MODULE_DIR/dsp/$MODULE_ID.c" \
      "$CORE_IMPL" \
      -o "build/render_fx_$MODULE_ID" \
      -Isrc \
      -I"$MODULE_DIR/dsp" \
      -lm

    "./build/render_fx_$MODULE_ID" "renders/$MODULE_ID-demo.wav"

    if [ "${1:-}" = "--suite" ]; then
      rm -rf "renders/$MODULE_ID-suite"
      mkdir -p "renders/$MODULE_ID-suite"
      RENDER_BIN="./build/render_fx_$MODULE_ID" RENDER_KIND=audio_fx node scripts/render-suite.ts
    elif [ "${1:-}" = "--stress" ]; then
      rm -rf "renders/$MODULE_ID-stress"
      mkdir -p "renders/$MODULE_ID-stress"
      RENDER_BIN="./build/render_fx_$MODULE_ID" RENDER_KIND=audio_fx node scripts/render-stress.ts
    fi
    ;;

  midi_fx)
    cc -std=c11 -O2 -g \
      tools/trace_midi_fx.c \
      "$MODULE_DIR/dsp/$MODULE_ID.c" \
      "$CORE_IMPL" \
      -o "build/trace_midi_fx_$MODULE_ID" \
      -Isrc \
      -I"$MODULE_DIR/dsp" \
      -lm

    "./build/trace_midi_fx_$MODULE_ID" "renders/$MODULE_ID-demo.trace"

    if [ "${1:-}" = "--suite" ]; then
      rm -rf "renders/$MODULE_ID-suite"
      mkdir -p "renders/$MODULE_ID-suite"
      RENDER_BIN="./build/trace_midi_fx_$MODULE_ID" RENDER_KIND=midi_fx node scripts/render-suite.ts
    fi
    ;;

  *)
    echo "[$MODULE_ID] skipping render: component_type='$COMPONENT_TYPE' (no offline harness for this kind)" >&2
    exit 0
    ;;
esac
