#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Run the same gate as `make check` rather than a hand-rolled subset.
#
# This script previously ran test + validate + suite + build-host and then
# installed — omitting typecheck, test:ui-chain, check-renders, stress and plot.
# So `mise run deploy` could ship to hardware without ever comparing renders
# against their goldens, which is the one check most likely to catch a change
# that sounds wrong.
make check

./scripts/install-to-move.sh
