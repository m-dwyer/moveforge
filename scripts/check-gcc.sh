#!/usr/bin/env bash
# Compile every C test with a real GCC, under both the flag sets CI uses.
#
# Apple clang does not implement -Wformat-truncation at all, so an entire class
# of -Werror failure is invisible on macOS: `mise run check` passes locally and
# CI fails on identical source. Two CI round-trips were spent on exactly that,
# and the second failure was in the *sanitizer* pass only — GCC's range analysis
# at -O1 differs from -O2, so even a plain GCC build would not have caught it.
#
# This compiles only. Running the binaries is `scripts/test.sh`'s job; the point
# here is the diagnostics, and on an arm64 Mac an x86 container would emulate
# every instruction to tell us nothing new.
#
# The job list comes from scripts/module-target.ts on the host rather than being
# reconstructed in the container: that resolver already knows a Faust module
# compiles its adapter and not its generated C, and a second copy of that
# knowledge here would drift.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

IMAGE="${GCC_IMAGE:-gcc:14}"

if ! docker info >/dev/null 2>&1; then
  echo "check-gcc: needs Docker (no real GCC on macOS — Apple clang aliases /usr/bin/gcc)" >&2
  exit 2
fi

module_target() { node scripts/module-target.ts "$@"; }

MANIFEST="$(mktemp)"
trap 'rm -f "$MANIFEST"' EXIT

# label|extra include|sources  — '|' because a tab cannot be written as a
# delimiter inside the single-quoted container script without fighting the quoting
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

echo "check-gcc: $(wc -l <"$MANIFEST" | tr -d ' ') targets x 2 passes, in $IMAGE"

docker run --rm -v "$ROOT":/w -w /w -v "$MANIFEST":/manifest:ro "$IMAGE" bash -euo pipefail -c '
SAN="-fsanitize=address,undefined -fno-omit-frame-pointer -fno-sanitize-recover=all"
fail=0
run() { # pass-label, opt, extra, label, includes, sources
  if ! gcc -std=c11 "$2" -g -Wall -Wextra -Werror $3 $5 $6 \
       -o /tmp/out -Isrc -Itools -lm 2>/tmp/err; then
    echo "FAIL [$1] $4"
    grep -E "error:" /tmp/err | head -4 | sed "s/^/    /"
    fail=1
  fi
}
while IFS="|" read -r label inc srcs; do
  [ -n "$label" ] || continue
  run plain "-O2" ""     "$label" "$inc" "$srcs"
  run san   "-O1" "$SAN" "$label" "$inc" "$srcs"
done </manifest
if [ "$fail" -eq 0 ]; then echo "check-gcc: all targets clean under gcc -Werror, both passes"; fi
exit "$fail"
'
