#!/usr/bin/env bash
# Format (or check) the hand-written C. Generated files are excluded via
# .clang-format-ignore.
#
# NOTE: the repo is not yet formatted — a first pass would rewrite ~34% of
# lines, so it is deliberately left as its own commit rather than mixed into
# functional changes. `format-check` is therefore not in `make check` yet.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1

CF="${CLANG_FORMAT:-}"
if [ -z "$CF" ]; then
  for candidate in clang-format /opt/homebrew/opt/llvm/bin/clang-format /usr/bin/clang-format; do
    if command -v "$candidate" >/dev/null 2>&1; then CF="$candidate"; break; fi
  done
fi
if [ -z "$CF" ]; then
  echo "clang-format not found. Install it (brew install llvm) or set CLANG_FORMAT=/path/to/clang-format." >&2
  exit 1
fi

FILES="$(git ls-files \
  'src/modules/*/dsp/*.c' 'src/modules/*/dsp/*.h' \
  'src/modules/_shared/*.h' \
  'src/host/*.c' 'src/host/*.h' \
  'tools/*.c' 'tools/*.h' \
  'tests/*.c' | grep -v '_faust\.c$' || true)"

if [ -z "$FILES" ]; then
  echo "no C sources found"
  exit 0
fi

if [ "$CHECK" = "1" ]; then
  status=0
  for f in $FILES; do
    if ! "$CF" "$f" | diff -q "$f" - >/dev/null; then
      echo "needs formatting: $f"
      status=1
    fi
  done
  [ "$status" = "0" ] && echo "all C sources formatted"
  exit $status
fi

# shellcheck disable=SC2086
"$CF" -i $FILES
echo "formatted $(echo "$FILES" | wc -l | tr -d ' ') file(s)"
