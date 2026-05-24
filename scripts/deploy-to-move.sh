#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

./scripts/test.sh
./scripts/render-demo.sh --suite
./scripts/build-host.sh
./scripts/install-to-move.sh
