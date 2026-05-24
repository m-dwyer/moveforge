#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PORT="${PORT:-8765}"
POLL_SECONDS="${POLL_SECONDS:-2}"
MODULE_ID="${MODULE_ID:-westfold}"
export MODULE_ID

./scripts/build-wasm.sh

python3 -m http.server "$PORT" &
SERVER_PID="$!"
trap 'kill "$SERVER_PID" >/dev/null 2>&1 || true' EXIT INT TERM

sleep 0.3
if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
  echo "Could not start server on port ${PORT}. Try PORT=8766 mise run dev." >&2
  exit 1
fi

echo "Serving http://localhost:${PORT}/web/?module=${MODULE_ID}"
echo "Watching src/modules/${MODULE_ID} and web/westfold-worklet.js"

snapshot() {
  find "src/modules/${MODULE_ID}" web/westfold-worklet.js \
    -type f \
    -print 2>/dev/null \
    | sort \
    | while IFS= read -r file; do
        if stat -f '%m %N' "$file" >/dev/null 2>&1; then
          stat -f '%m %N' "$file"
        else
          stat -c '%Y %n' "$file"
        fi
      done
}

last="$(snapshot)"
while true; do
  sleep "$POLL_SECONDS"
  current="$(snapshot)"
  if [ "$current" != "$last" ]; then
    echo "Change detected; rebuilding WASM..."
    if ./scripts/build-wasm.sh; then
      echo "WASM rebuilt. Reload the browser tab."
      last="$current"
    else
      echo "WASM rebuild failed; keeping watcher alive." >&2
    fi
  fi
done
