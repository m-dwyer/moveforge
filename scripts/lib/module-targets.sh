#!/usr/bin/env bash

moveforge_module_ids() {
  if [ -n "${MODULE_ID:-}" ]; then
    printf '%s\n' "$MODULE_ID"
  else
    find src/modules -mindepth 1 -maxdepth 1 -type d ! -name '_*' -exec basename {} \; | sort
  fi
}

moveforge_module_dir() {
  printf 'src/modules/%s\n' "$1"
}

moveforge_wrapper_c() {
  printf 'src/modules/%s/dsp/%s.c\n' "$1" "$1"
}

moveforge_core_header() {
  printf 'src/modules/%s/dsp/%s_core.h\n' "$1" "$1"
}

moveforge_faust_c() {
  printf 'src/modules/%s/dsp/%s_faust.c\n' "$1" "$1"
}

moveforge_test_core_c() {
  printf 'tests/test_%s_core.c\n' "$1"
}

moveforge_test_plugin_c() {
  printf 'tests/test_%s_plugin.c\n' "$1"
}

moveforge_core_impl() {
  local module_id="$1"
  local module_dir="src/modules/$module_id"
  if [ -f "$module_dir/dsp/$module_id.dsp" ]; then
    printf '%s/dsp/%s_adapter.c\n' "$module_dir" "$module_id"
  else
    printf '%s/dsp/%s_core.c\n' "$module_dir" "$module_id"
  fi
}

moveforge_component_type() {
  local module_id="$1"
  local module_json="src/modules/$module_id/module.json"
  node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).capabilities?.component_type ?? '')" "$module_json"
}

moveforge_render_bin() {
  local module_id="$1"
  local component_type="$2"
  case "$component_type" in
    audio_fx) printf './build/render_fx_%s\n' "$module_id" ;;
    midi_fx) printf './build/trace_midi_fx_%s\n' "$module_id" ;;
    *)        printf './build/render_wav_%s\n' "$module_id" ;;
  esac
}

moveforge_render_demo_out() {
  local module_id="$1"
  local component_type="$2"
  case "$component_type" in
    midi_fx) printf 'renders/%s-demo.trace\n' "$module_id" ;;
    *)       printf 'renders/%s-demo.wav\n' "$module_id" ;;
  esac
}

moveforge_device_component_dir() {
  local module_id="$1"
  local component_type
  component_type="$(moveforge_component_type "$module_id")"
  case "$component_type" in
    sound_generator) printf 'sound_generators\n' ;;
    audio_fx)        printf 'audio_fx\n' ;;
    midi_fx)         printf 'midi_fx\n' ;;
    *)
      echo "unrecognized component_type for $module_id: $component_type" >&2
      return 2
      ;;
  esac
}
