#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

module_target() {
  node scripts/module-target.ts "$@"
}

MODULE_IDS="$(module_target ids)"
mkdir -p build

# Second pass under AddressSanitizer + UndefinedBehaviorSanitizer.
#
# Worth the ~2x runtime here specifically: the modules carry fixed-size ring
# buffers indexed by computed offsets (lobber's masked 1<<19 buffers, trail's
# delay lines), Faust adapters write through zone pointers held in hand-sized
# arrays, and there are float->int conversions at every audio boundary. Those
# are exactly ASan/UBSan's targets, and none of them are visible to a plain -O2
# build or to the metric checks.
#
# Set MOVEFORGE_NO_SANITIZE=1 to skip (e.g. a toolchain without the runtimes).
SAN_FLAGS=""
if [ "${MOVEFORGE_NO_SANITIZE:-0}" != "1" ]; then
  SAN_FLAGS="-fsanitize=address,undefined -fno-omit-frame-pointer -fno-sanitize-recover=all"
fi
export ASAN_OPTIONS="${ASAN_OPTIONS:-detect_leaks=0}"
export UBSAN_OPTIONS="${UBSAN_OPTIONS:-print_stacktrace=1,halt_on_error=1}"

# Shared DSP blocks (src/modules/_shared) and the render harnesses' shared
# argument handling (tools/render_*.h) are module-independent, so they are tested
# once rather than per module.
for SHARED_TEST in tests/test_mf_dsp.c tests/test_render_harness.c; do
  SHARED_NAME="$(basename "$SHARED_TEST" .c)"
  cc -std=c11 -O2 -g -Wall -Wextra -Werror \
    "$SHARED_TEST" \
    -o "build/${SHARED_NAME}" \
    -Isrc \
    -lm

  "./build/${SHARED_NAME}"
done

for MODULE_ID in $MODULE_IDS; do
  MODULE_DIR="$(module_target module-dir "$MODULE_ID")"
  CORE_IMPL="$(module_target core-impl "$MODULE_ID")"
  WRAPPER_C="$(module_target wrapper-c "$MODULE_ID")"
  TEST_CORE_C="$(module_target test-core-c "$MODULE_ID")"
  TEST_PLUGIN_C="$(module_target test-plugin-c "$MODULE_ID")"
  cc -std=c11 -O2 -g -Wall -Wextra -Werror \
    "$TEST_CORE_C" \
    "$CORE_IMPL" \
    -o "build/test_${MODULE_ID}_core" \
    -Isrc \
    -I"$MODULE_DIR/dsp" \
    -lm

  "./build/test_${MODULE_ID}_core"

  if [ -f "$TEST_PLUGIN_C" ]; then
    cc -std=c11 -O2 -g -Wall -Wextra -Werror \
      "$TEST_PLUGIN_C" \
      "$WRAPPER_C" \
      "$CORE_IMPL" \
      -o "build/test_${MODULE_ID}_plugin" \
      -Isrc \
      -I"$MODULE_DIR/dsp" \
      -lm

    "./build/test_${MODULE_ID}_plugin"
  fi
done

if [ -n "$SAN_FLAGS" ]; then
  echo "--- sanitizer pass (ASan + UBSan) ---"

  for SHARED_TEST in tests/test_mf_dsp.c tests/test_render_harness.c; do
    SHARED_NAME="$(basename "$SHARED_TEST" .c)"
    cc -std=c11 -O1 -g -Wall -Wextra -Werror $SAN_FLAGS \
      "$SHARED_TEST" \
      -o "build/${SHARED_NAME}_san" \
      -Isrc \
      -lm

    "./build/${SHARED_NAME}_san" >/dev/null
    echo "  ${SHARED_NAME}: clean"
  done

  for MODULE_ID in $MODULE_IDS; do
    MODULE_DIR="$(module_target module-dir "$MODULE_ID")"
    CORE_IMPL="$(module_target core-impl "$MODULE_ID")"
    WRAPPER_C="$(module_target wrapper-c "$MODULE_ID")"
    TEST_CORE_C="$(module_target test-core-c "$MODULE_ID")"
    TEST_PLUGIN_C="$(module_target test-plugin-c "$MODULE_ID")"

    cc -std=c11 -O1 -g -Wall -Wextra -Werror $SAN_FLAGS \
      "$TEST_CORE_C" \
      "$CORE_IMPL" \
      -o "build/test_${MODULE_ID}_core_san" \
      -Isrc \
      -I"$MODULE_DIR/dsp" \
      -lm

    "./build/test_${MODULE_ID}_core_san" >/dev/null

    if [ -f "$TEST_PLUGIN_C" ]; then
      cc -std=c11 -O1 -g -Wall -Wextra -Werror $SAN_FLAGS \
        "$TEST_PLUGIN_C" \
        "$WRAPPER_C" \
        "$CORE_IMPL" \
        -o "build/test_${MODULE_ID}_plugin_san" \
        -Isrc \
        -I"$MODULE_DIR/dsp" \
        -lm

      "./build/test_${MODULE_ID}_plugin_san" >/dev/null
    fi
    echo "  ${MODULE_ID}: clean"
  done
fi
