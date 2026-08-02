#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
. "$ROOT/scripts/lib/move-guards.sh"

module_target() {
  node scripts/module-target.ts "$@"
}

MODULE_IDS="$(module_target ids)"
MOVE_HOST="${MOVE_HOST:-ableton@move.local}"
FORCE=0

for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    -h|--help)
      cat <<EOF
Usage: $(basename "$0") [--force]

Install already-built module(s) from dist/ to \$MOVE_HOST. This does not build:
run 'mise run move-install' (build + install) or 'mise run move-deploy'
(check + build + install) rather than calling this directly.
Without MODULE_ID, installs every module. Set MODULE_ID=<id> to target one.

Pre-flight checks (any failure aborts unless --force):
  * dist/<id>/dsp.so must exist and be aarch64
  * \$MOVE_HOST must be reachable over SSH
  * remote module partition must have at least 10 MiB free

Files are staged to a temporary directory on the device and renamed into place,
so a shared object the host currently has dlopen'd is never truncated. The
rename is atomic per file, not for the directory as a whole: if it fails part
way the staged copy is kept and the module directory is left part old, part new.

After install, every shipped file is verified against the local build by
checksum — not just dsp.so, since the chain host loads audio FX from <id>/<id>.so.
Files already on the device that this build does not ship are reported but never
removed.

Environment:
  MODULE_ID         optional module directory under src/modules/
  MOVE_HOST         SSH target (default: ableton@move.local)
  COMPONENT_TYPE    Schwung modules subdir override for single-module installs.
                    Auto-inferred from src/modules/\$MODULE_ID/module.json by default.
EOF
      exit 0
      ;;
    *)
      echo "unknown arg: $arg (try --help)" >&2
      exit 2
      ;;
  esac
done

if [ -n "${COMPONENT_TYPE:-}" ] && [ -z "${MODULE_ID:-}" ]; then
  echo "install-to-move: COMPONENT_TYPE override requires MODULE_ID=<id>" >&2
  exit 2
fi

move_guard_validate_host "$MOVE_HOST"
if [ -n "${COMPONENT_TYPE:-}" ]; then
  move_guard_validate_component_type "$COMPONENT_TYPE"
fi

fail() {
  echo "install-to-move: $1" >&2
  if [ "$FORCE" = "1" ]; then
    echo "  (continuing because --force was passed)" >&2
  else
    echo "  re-run with --force to override" >&2
    exit 1
  fi
}

component_dir_for() {
  local module_id="$1"
  if [ -n "${COMPONENT_TYPE:-}" ]; then
    echo "$COMPONENT_TYPE"
    return
  fi

  module_target device-component-dir "$module_id"
}

echo "install-to-move: checking SSH to $MOVE_HOST"
if ! ssh -o ConnectTimeout=5 -o BatchMode=yes "$MOVE_HOST" true 2>/dev/null; then
  fail "cannot SSH to $MOVE_HOST (key-based auth must be set up)"
fi

FREE_KB=$(ssh "$MOVE_HOST" "df -P /data/UserData | awk 'NR==2 {print \$4}'" 2>/dev/null || echo 0)
FREE_MB=$(( FREE_KB / 1024 ))
if [ "$FREE_MB" -lt 10 ]; then
  fail "/data/UserData has only ${FREE_MB} MiB free on $MOVE_HOST (need >= 10 MiB)"
fi
echo "install-to-move: $MOVE_HOST /data/UserData has ${FREE_MB} MiB free"

# Agree on a checksum both ends can compute. The device is busybox-ish and macOS
# ships shasum/md5 rather than the GNU *sum names, so neither side can assume.
# Output is normalised to "<hash> <path>" with awk, since md5(1) prints one
# space and the *sum tools print two.
SUM_ALGO=""
REMOTE_SUM=""
LOCAL_SUM=()
for algo in sha256 md5; do
  case "$algo" in
    sha256) remote_try="sha256sum"; local_try="sha256sum shasum" ;;
    md5)    remote_try="md5sum";    local_try="md5sum md5" ;;
  esac
  ssh "$MOVE_HOST" "command -v $remote_try >/dev/null 2>&1" || continue
  for candidate in $local_try; do
    command -v "$candidate" >/dev/null 2>&1 || continue
    case "$candidate" in
      shasum) LOCAL_SUM=(shasum -a 256) ;;
      md5)    LOCAL_SUM=(md5 -r) ;;
      *)      LOCAL_SUM=("$candidate") ;;
    esac
    break
  done
  [ "${#LOCAL_SUM[@]}" -gt 0 ] || continue
  SUM_ALGO="$algo"
  REMOTE_SUM="$remote_try"
  break
done
[ -n "$SUM_ALGO" ] || fail "no checksum tool available on both this machine and $MOVE_HOST — cannot verify the install"

# "<path> <hash>" per file, sorted by path.
#
# Hash first and sort the *output*, rather than sorting find's NUL-separated
# output before hashing: `sort -z` is a busybox compile-time option
# (CONFIG_FEATURE_SORT_BIG) and is missing on some devices. When it is, the
# remote sort dies, `xargs -0` gets no input and still exits 0, so ssh returns
# 0, pipefail never fires, and the remote manifest comes back empty — a correct
# install then reports every file as missing. Sorting plain lines needs nothing
# optional at either end.
#
# The awk splits on the first run of whitespace only: md5(1) prints one space
# and the *sum tools print two, and taking $NF instead would truncate any path
# containing a space to its last word on both sides.
normalise_manifest() {
  awk '{ h = $1; sub(/^[^ \t]+[ \t]+/, ""); print $0 " " h }' | LC_ALL=C sort
}
manifest_local() {
  (cd "$1" && find . -type f -exec "${LOCAL_SUM[@]}" {} +) | normalise_manifest
}
manifest_remote() {
  ssh "$MOVE_HOST" "cd '$1' && find . -type f -exec $REMOTE_SUM {} +" | normalise_manifest
}

for MODULE_ID in $MODULE_IDS; do
  move_guard_validate_module_id "$MODULE_ID"
  COMPONENT_DIR="$(component_dir_for "$MODULE_ID")"
  move_guard_validate_component_type "$COMPONENT_DIR"
  REMOTE_DIR="/data/UserData/schwung/modules/$COMPONENT_DIR"

  # Installing never builds. `mise run move-install` and `mise run move-deploy`
  # both depend on move-build, so the artifact is already current by the time we
  # get here — and when this script built for itself, it re-entered the
  # cross-compile container once per module, and `move-deploy` built everything
  # twice (once inside the check gate, once here).
  if [ ! -f "dist/$MODULE_ID/dsp.so" ]; then
    echo "install-to-move: dist/$MODULE_ID/dsp.so is missing — run 'mise run move-build' first" >&2
    exit 1
  fi

  LOCAL_SO="dist/$MODULE_ID/dsp.so"
  ARCH=$(file -b "$LOCAL_SO" 2>/dev/null || echo unknown)
  case "$ARCH" in
    *aarch64*|*ARM\ aarch64*) ;;
    *) fail "dist/$MODULE_ID/dsp.so is not aarch64 (file says: $ARCH)" ;;
  esac

  LOCAL_SIZE=$(wc -c <"$LOCAL_SO" | tr -d ' ')
  echo "install-to-move: [$MODULE_ID] local dsp.so ${LOCAL_SIZE} bytes ($ARCH)"

  TARGET_DIR="$REMOTE_DIR/$MODULE_ID"
  STAGE_DIR="$REMOTE_DIR/.$MODULE_ID.incoming"

  # Stage, then rename into place. A plain `scp` over the live directory
  # rewrites each file in place, and the host may have the .so dlopen'd
  # (chain_host.c:415 for sound generators, :243 for audio FX) — truncating a
  # mapping that is PROT_EXEC inside the audio callback. `mv` is a rename: it
  # is atomic and leaves the old inode intact for anything still holding it,
  # so a running instance keeps working until it is reloaded.
  ssh "$MOVE_HOST" "test -d /data/UserData/schwung && rm -rf '$STAGE_DIR' && mkdir -p '$STAGE_DIR' '$TARGET_DIR'"
  scp -r "dist/$MODULE_ID/." "$MOVE_HOST:$STAGE_DIR/"

  # The rename loop reads from a file rather than a pipe so its status survives:
  # `find | while ...` runs the loop in a subshell, so any mv failure (ENOSPC,
  # EROFS, a permissions problem) was lost, and the trailing `rm -rf` meant ssh
  # exited with *rm's* status. A half-moved directory then looked like success
  # and the staged copy it could have been retried from was already gone.
  if ! ssh "$MOVE_HOST" "
      set -u
      cd '$STAGE_DIR' || exit 1
      find . -type f > '$STAGE_DIR.list' || exit 1
      status=0
      while IFS= read -r f; do
        mkdir -p \"$TARGET_DIR/\$(dirname \"\$f\")\" || { status=1; continue; }
        mv -f \"\$f\" \"$TARGET_DIR/\$f\" || status=1
      done < '$STAGE_DIR.list'
      rm -f '$STAGE_DIR.list'
      [ \$status -eq 0 ] || exit 1
      cd / && rm -rf '$STAGE_DIR'
    "; then
    echo "install-to-move: ERROR [$MODULE_ID] failed to move staged files into $TARGET_DIR" >&2
    echo "  the staged copy is left at $MOVE_HOST:$STAGE_DIR — the module directory may be" >&2
    echo "  part old and part new, so re-run once the cause is fixed" >&2
    exit 1
  fi

  # Verify every shipped file, not just dsp.so. The chain host loads audio FX
  # from <id>/<id>.so, so for an FX module dsp.so was never the file that
  # mattered — and module.json, ui.js, ui_chain.js and presets.json were never
  # checked at all.
  echo "install-to-move: installed $MODULE_ID to $MOVE_HOST:$TARGET_DIR"

  if [ -z "$SUM_ALGO" ]; then
    # Only reachable under --force; without it the earlier `fail` exits. Say so
    # plainly rather than running the comparison with no hasher, which produced
    # an empty manifest and a bogus "could not checksum" error naming no tool.
    echo "install-to-move: WARNING [$MODULE_ID] install NOT verified — no checksum tool" >&2
    continue
  fi

  EXPECTED_FILES=$(find "dist/$MODULE_ID" -type f | wc -l | tr -d ' ')
  MANIFEST_LOCAL="$(manifest_local "dist/$MODULE_ID")"
  MANIFEST_REMOTE_ALL="$(manifest_remote "$TARGET_DIR")"

  # Guard the comparison itself: if a checksum command fails, both sides come
  # back empty and an equality test would pass vacuously — a check that cannot
  # fail is worse than no check.
  LOCAL_LINES=$(printf '%s\n' "$MANIFEST_LOCAL" | grep -c . || true)
  if [ "$EXPECTED_FILES" -eq 0 ] || [ "$LOCAL_LINES" != "$EXPECTED_FILES" ]; then
    echo "install-to-move: ERROR [$MODULE_ID] could not checksum the local build" \
         "($LOCAL_LINES of $EXPECTED_FILES files hashed with $SUM_ALGO)" >&2
    exit 1
  fi

  # Compare the files this build ships, not the whole remote directory. Nothing
  # here ever removes a file, so anything left behind by an earlier build — or
  # by a rename in the packaging step — used to make every subsequent install
  # fail with a mismatch, after having already moved the new files in, and with
  # no way out from the script. Extras are reported instead: worth knowing about
  # (a renamed ui_chain.js is still loadable) but they are not corruption.
  split_path='p = $0; sub(/ [^ ]*$/, "", p);'
  MANIFEST_REMOTE="$(awk "NR==FNR { $split_path keep[p] = 1; next } { $split_path if (p in keep) print }" \
    <(printf '%s\n' "$MANIFEST_LOCAL") <(printf '%s\n' "$MANIFEST_REMOTE_ALL"))"
  EXTRA="$(awk "NR==FNR { $split_path keep[p] = 1; next } { $split_path if (!(p in keep)) print p }" \
    <(printf '%s\n' "$MANIFEST_LOCAL") <(printf '%s\n' "$MANIFEST_REMOTE_ALL"))"

  if [ "$MANIFEST_LOCAL" != "$MANIFEST_REMOTE" ]; then
    echo "install-to-move: ERROR [$MODULE_ID] installed files do not match the local build" >&2
    diff <(printf '%s\n' "$MANIFEST_LOCAL") <(printf '%s\n' "$MANIFEST_REMOTE") >&2 || true
    exit 1
  fi

  echo "install-to-move: [$MODULE_ID] verified $LOCAL_LINES file(s) by $SUM_ALGO"
  if [ -n "$EXTRA" ]; then
    echo "install-to-move: NOTE [$MODULE_ID] $MOVE_HOST:$TARGET_DIR also holds files this build" >&2
    echo "  does not ship; remove them by hand if they are stale:" >&2
    printf '%s\n' "$EXTRA" | sed 's/^/    /' >&2
  fi
done
