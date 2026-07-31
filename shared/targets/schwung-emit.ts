/*
 * Emit `module.json` for the Schwung target from a module definition.
 *
 * This is where every Schwung-shaped fact that is *not* authored gets supplied:
 * the api version, the shared-object and UI filenames, the capabilities block,
 * and the `ui_hierarchy` spelling of the definition's ordered parameter groups.
 *
 * Key order matters here in a way it usually does not. The Schwung host finds a
 * level by scanning brace to brace (chain_params.c:439 `parse_hierarchy_params`),
 * so the order levels appear in the emitted *text* is the order it registers
 * their parameters — and that order is the ABI shared with the generated C enum
 * and the browser's parameter ids. `groups` is an array for exactly this reason,
 * and the object built below preserves it: JSON.stringify writes keys in
 * insertion order, so an ordered array of groups becomes an ordered object of
 * levels.
 */
import type { ModuleDefinition, ModuleKind, ParamGroup } from "../module-definition.ts";
import type { SchwungModuleJson } from "./schwung.ts";

/* Identical in every module and required by the host, so the emitter owns them
 * rather than nine copies of the same three lines. */
const API_VERSION = 2;
const DSP_FILENAME = "dsp.so";
const UI_FILENAME = "ui.js";
const UI_CHAIN_FILENAME = "ui_chain.js";

const COMPONENT_TYPE: Record<ModuleKind, string> = {
  effect: "audio_fx",
  instrument: "sound_generator",
  "midi-effect": "midi_fx"
};

/** The Schwung component type a definition's kind maps to. */
export function componentTypeFor(kind: ModuleKind): string {
  return COMPONENT_TYPE[kind];
}

function emitLevel(group: ParamGroup, definition: ModuleDefinition) {
  const browse = definition.preset_browse?.group === group.key ? definition.preset_browse : undefined;
  return {
    name: group.name ?? group.key,
    /* The browse keys sit between the level name and its params in every
     * hand-written module.json, and the host does not care, so this keeps the
     * shape a reader of the old files recognises. */
    ...(browse
      ? {
          list_param: browse.list_param,
          count_param: browse.count_param,
          name_param: browse.name_param
        }
      : {}),
    params: group.params,
    ...(group.knobs ? { knobs: group.knobs } : {})
  };
}

/**
 * Build the `module.json` a Schwung host will load.
 *
 * Returns a plain object; serialising it (and deciding on indentation) is the
 * caller's job, because the browser wants the value and the generator wants
 * bytes.
 */
export function emitSchwungModuleJson(definition: ModuleDefinition): SchwungModuleJson {
  const levels: Record<string, unknown> = {};
  for (const group of definition.groups) levels[group.key] = emitLevel(group, definition);

  return {
    id: definition.id,
    name: definition.name,
    abbrev: definition.abbrev,
    ...(definition.version ? { version: definition.version } : {}),
    ...(definition.description ? { description: definition.description } : {}),
    ...(definition.author ? { author: definition.author } : {}),
    ui: UI_FILENAME,
    ui_chain: UI_CHAIN_FILENAME,
    dsp: DSP_FILENAME,
    api_version: API_VERSION,
    /* Deliberately not repeated at the top level. The host reads it with
     * json_get_string (module_manager.c:14-26), which is a bare strstr over the
     * whole document rather than a top-level lookup, so the copy inside
     * `capabilities` is what it finds either way. Eight of the nine hand-written
     * module.json files omitted the top-level one and loaded fine; trail carried
     * it and was the outlier. */
    capabilities: {
      audio_out: definition.io.audio_out,
      audio_in: definition.io.audio_in,
      midi_in: definition.io.midi_in,
      midi_out: definition.io.midi_out,
      /* Every module built here is meant to sit in a chain slot. A target-level
       * default rather than an authored field: it says nothing about the module,
       * only about how Schwung is expected to host it. */
      chainable: true,
      ...(definition.requires_continuous_processing
        ? { requires_continuous_processing: true }
        : {}),
      component_type: componentTypeFor(definition.kind),
      ...(definition.scope ? { scope: definition.scope } : {}),
      ui_hierarchy: { levels }
    }
  } as SchwungModuleJson;
}
