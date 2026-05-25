#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

UPSTREAM_DIR="${UPSTREAM_DIR:-upstream/schwung}"
REMOTE="${REMOTE:-origin}"

usage() {
  cat <<EOF
Usage: $(basename "$0")

Update the vendored Schwung reference checkout at \$UPSTREAM_DIR.

Environment:
  UPSTREAM_DIR  path to Schwung checkout (default: upstream/schwung)
  REMOTE        git remote to fetch/pull (default: origin)
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

if [ ! -d "$UPSTREAM_DIR/.git" ]; then
  echo "update-upstream-schwung: $UPSTREAM_DIR is not a git checkout" >&2
  exit 1
fi

git -C "$UPSTREAM_DIR" fetch "$REMOTE"
git -C "$UPSTREAM_DIR" pull --ff-only "$REMOTE" "$(git -C "$UPSTREAM_DIR" branch --show-current)"
git -C "$UPSTREAM_DIR" rev-parse --short HEAD
