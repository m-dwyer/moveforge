#!/usr/bin/env bash
# Run the C tests under ASan + UBSan on Linux, in Docker.
#
# `mise run test-c-san` on a Mac is not the same test. LeakSanitizer ships with
# ASan on Linux and does not exist under Apple clang, so a module that never
# frees what its init allocated passes locally and fails in CI — which is
# exactly what happened: three Faust core tests leaked, `check` was green on
# macOS, and the CI job was red. This is the pass that would have caught it.
#
# Sibling of check-gcc.sh, which compiles the same targets under real GCC for
# the diagnostics Apple clang does not implement. That one deliberately does not
# run the binaries; this one exists to run them.
#
# The job list comes from scripts/module-target.ts on the host rather than being
# reconstructed in the container, for the same reason check-gcc.sh does it: the
# resolver already knows a Faust module compiles its adapter and not its
# generated C, and a second copy of that knowledge here would drift.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

IMAGE="${GCC_IMAGE:-gcc:14}"

# Run natively. An emulated x86 container works but is slow enough that nobody
# runs it twice, and the sanitizers care about the OS, not the ISA.
case "$(uname -m)" in
  arm64 | aarch64) HOST_PLATFORM="linux/arm64" ;;
  *) HOST_PLATFORM="linux/amd64" ;;
esac
PLATFORM="${GCC_PLATFORM:-$HOST_PLATFORM}"

if ! docker info >/dev/null 2>&1; then
  echo "test-c-linux: needs Docker (LeakSanitizer does not exist under Apple clang)" >&2
  exit 2
fi

module_target() { node scripts/module-target.ts "$@"; }

MANIFEST="$(mktemp)"
trap 'rm -f "$MANIFEST"' EXIT

# label|extra include|sources — '|' because a tab cannot be written as a
# delimiter inside the single-quoted container script without fighting the quoting.
{
  printf 'mf_dsp||tests/test_mf_dsp.c\n'
  if [ -f tests/test_render_harness.c ]; then
    printf 'render_harness||tests/test_render_harness.c\n'
  fi
  for MODULE_ID in $(module_target ids); do
    DIR="$(module_target module-dir "$MODULE_ID")"
    CORE="$(module_target core-impl "$MODULE_ID")"
    WRAP="$(module_target wrapper-c "$MODULE_ID")"
    TCORE="$(module_target test-core-c "$MODULE_ID")"
    TPLUG="$(module_target test-plugin-c "$MODULE_ID")"
    [ -f "$TCORE" ] && printf '%s core|-I%s/dsp|%s %s\n' "$MODULE_ID" "$DIR" "$TCORE" "$CORE"
    [ -f "$TPLUG" ] && printf '%s plugin|-I%s/dsp|%s %s %s\n' "$MODULE_ID" "$DIR" "$TPLUG" "$WRAP" "$CORE"
  done
} >"$MANIFEST"

echo "test-c-linux: $(wc -l <"$MANIFEST" | tr -d ' ') targets in $IMAGE ($PLATFORM)"

docker run --rm --platform "$PLATFORM" -v "$ROOT":/w:ro -w /w -v "$MANIFEST":/manifest:ro "$IMAGE" \
  bash -euo pipefail -c '
# Matches TEST_SAN_VARIANT in scripts/lib/toolchains.ts. Deliberately *not*
# setting ASAN_OPTIONS=detect_leaks=0: the old scripts/test.sh did, which is why
# the leaks it was masking went unnoticed until CI moved to a Linux runner.
SAN="-fsanitize=address,undefined -fno-omit-frame-pointer -fno-sanitize-recover=all"
export UBSAN_OPTIONS="print_stacktrace=1,halt_on_error=1"
fail=0
while IFS="|" read -r label inc srcs; do
  [ -n "$label" ] || continue
  bin="/tmp/$(echo "$label" | tr " " "_")"
  if ! gcc -std=c11 -O1 -g -Wall -Wextra -Werror $SAN -Isrc -Itools $inc $srcs -o "$bin" -lm 2>/tmp/err; then
    echo "FAIL [compile] $label"
    grep -E "error:" /tmp/err | head -4 | sed "s/^/    /"
    fail=1
    continue
  fi
  if "$bin" >/dev/null 2>/tmp/err; then
    echo "ok: $label"
  else
    echo "FAIL [run] $label"
    grep -E "ERROR|SUMMARY|runtime error" /tmp/err | head -6 | sed "s/^/    /"
    fail=1
  fi
done </manifest
if [ "$fail" -eq 0 ]; then echo "test-c-linux: all targets pass under ASan+UBSan+LSan on Linux"; fi
exit "$fail"
'
