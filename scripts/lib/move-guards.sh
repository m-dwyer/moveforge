#!/usr/bin/env bash

move_guard_fail() {
  echo "$(basename "$0"): $1" >&2
  exit 2
}

move_guard_validate_host() {
  local host="$1"
  [ -n "$host" ] || move_guard_fail "MOVE_HOST cannot be empty"
  case "$host" in
    *"'"*|*\"*|*";"*|*"|"*|*"&"*|*"<"*|*">"*|*"\`"*|*'$('*|*$'\n'*|*$'\r'*)
      move_guard_fail "MOVE_HOST contains unsafe shell characters: $host"
      ;;
  esac
}

move_guard_validate_module_id() {
  local module_id="$1"
  case "$module_id" in
    ""|_*|*[^a-z0-9_]*)
      move_guard_fail "MODULE_ID must match [a-z][a-z0-9_]* and cannot start with _: $module_id"
      ;;
  esac
  case "$module_id" in
    [a-z]*) ;;
    *) move_guard_fail "MODULE_ID must start with a lowercase letter: $module_id" ;;
  esac
}

move_guard_validate_component_type() {
  local component_type="$1"
  case "$component_type" in
    sound_generators|audio_fx|midi_fx|overtake) ;;
    *) move_guard_fail "COMPONENT_TYPE must be one of sound_generators, audio_fx, midi_fx, overtake: $component_type" ;;
  esac
}

move_guard_validate_schwung_dir() {
  local dir="$1"
  case "$dir" in
    /data/UserData/schwung|/data/UserData/schwung/*) ;;
    *) move_guard_fail "SCHWUNG_DIR must stay under /data/UserData/schwung: $dir" ;;
  esac
  case "$dir" in
    *".."*|*"//"*|*"'"*|*\"*|*";"*|*"|"*|*"&"*|*"<"*|*">"*|*"\`"*|*'$('*|*"*"*|*"?"*|*"["*|*$'\n'*|*$'\r'*)
      move_guard_fail "SCHWUNG_DIR contains unsafe path characters: $dir"
      ;;
  esac
}

move_guard_validate_positive_int() {
  local name="$1"
  local value="$2"
  case "$value" in
    ""|*[!0-9]*) move_guard_fail "$name must be a positive integer: $value" ;;
  esac
  [ "$value" -gt 0 ] || move_guard_fail "$name must be greater than zero: $value"
}

move_guard_confirm() {
  local prompt="$1"
  if [ "${MOVEFORGE_YES:-0}" = "1" ]; then
    return 0
  fi
  printf "%s [y/N] " "$prompt" >&2
  local answer
  read -r answer
  case "$answer" in
    y|Y|yes|YES) ;;
    *) echo "aborted" >&2; exit 1 ;;
  esac
}
