/*
 * The authored form of a module: `module.def.json`.
 *
 * This is the source of truth. Everything a target needs is either here or
 * supplied by that target's emitter — `src/modules/<id>/module.json` is now
 * generated from this by `scripts/gen-module-json.ts` for the Schwung target,
 * and a CLAP or VST target would emit something else entirely from the same
 * definition.
 *
 * Built on `module-schema.ts`'s parameter vocabulary, which is why nothing here
 * mentions a host. The two rules that shaped it:
 *
 *   Parameter order is an ABI. `groups` is an ordered list, not a map, because
 *   the flattened order of their parameters is the index the generated C enum,
 *   the device's knob list and the browser's parameter ids all agree on. A map
 *   would put that order at the mercy of key insertion and JS's integer-key
 *   enumeration — the hazard `ui-hierarchy.ts` documents at length.
 *
 *   Only describe what varies. `api_version`, `dsp: "dsp.so"` and the ui
 *   filenames are identical in all nine modules and exist only because the
 *   Schwung host reads them, so the emitter supplies them and they are absent
 *   here. `midi_in` on an effect is not derivable — lobber accepts MIDI and
 *   trail does not — so `io` is authored.
 */
import { z } from "zod";

import { paramSchema, parseWith } from "./module-schema.ts";

/**
 * What the module is, in target-neutral terms.
 *
 * Schwung spells these `sound_generator` / `audio_fx` / `midi_fx`; a plugin
 * target would spell the first two as instrument and effect. The mapping is the
 * emitter's business.
 */
export const MODULE_KINDS = ["instrument", "effect", "midi-effect"] as const;

/**
 * One bank of parameters.
 *
 * `knobs` names the parameters this bank puts on hardware controls, in control
 * order — a subset of `params`, by key. Eight is what Move offers; a target with
 * a different number takes the first N, and one with no hardware ignores it.
 */
export const paramGroupSchema = z.looseObject({
  /* Stable identifier for the bank. Distinct from `name`, which is a label:
   * "1 Hat" is what a performer reads, `hat` is what the tooling addresses. */
  key: z.string().min(1),
  knobs: z.array(z.string()).optional(),
  name: z.string().optional(),
  params: z.array(paramSchema).default([])
});

/**
 * Which signals the module consumes and produces.
 *
 * Mostly implied by `kind`, but not entirely, so it is stated rather than
 * inferred: an effect that also listens to MIDI is an ordinary thing to want and
 * there is no way to derive it.
 */
export const moduleIoSchema = z.looseObject({
  audio_in: z.boolean(),
  audio_out: z.boolean(),
  midi_in: z.boolean(),
  midi_out: z.boolean()
});

/**
 * A visualisation hint for the module's own screen. moveforge-local rather than
 * universal, but it describes the module's output, not any host's UI, so it is
 * authored here and each target decides whether it can honour it.
 */
export const scopeSchema = z.looseObject({
  mode: z.string().optional(),
  style: z.string().optional(),
  window: z.number().optional()
});

/**
 * Wiring for a host-provided preset browser: the parameters that carry the
 * selected index, the count, and the name. Named parameters rather than a
 * boolean because the host addresses them by key.
 */
export const presetBrowseSchema = z.looseObject({
  count_param: z.string(),
  group: z.string(),
  list_param: z.string(),
  name_param: z.string()
});

export const moduleDefinitionSchema = z.looseObject({
  /* Short label for displays with no room for `name`. The length limit is a
   * target's business — Schwung's chain slot wants 3-6. */
  abbrev: z.string().min(1),
  author: z.string().optional(),
  description: z.string().optional(),
  groups: z.array(paramGroupSchema).min(1),
  id: z.string(),
  io: moduleIoSchema,
  kind: z.enum(MODULE_KINDS),
  name: z.string(),
  preset_browse: presetBrowseSchema.optional(),
  /* The module keeps processing when no note is sounding — a delay or reverb
   * tail must not be cut off when the last voice ends. */
  requires_continuous_processing: z.boolean().optional(),
  scope: scopeSchema.optional(),
  version: z.string().optional()
});

export type ModuleKind = (typeof MODULE_KINDS)[number];
export type ParamGroup = z.infer<typeof paramGroupSchema>;
export type ModuleIo = z.infer<typeof moduleIoSchema>;
export type ScopeConfig = z.infer<typeof scopeSchema>;
export type PresetBrowse = z.infer<typeof presetBrowseSchema>;
export type ModuleDefinition = z.infer<typeof moduleDefinitionSchema>;

export function parseModuleDefinition(value: unknown, source: string): ModuleDefinition {
  return parseWith(moduleDefinitionSchema, value, source);
}

/**
 * Every parameter, in the order that is the ABI.
 *
 * The one walk over a definition's parameters, for the same reason
 * `ui-hierarchy.ts` is the one walk over a Schwung `ui_hierarchy`: a second walk
 * that disagrees is a module addressing the wrong parameters with nothing
 * failing.
 */
export function definitionParams(definition: ModuleDefinition) {
  return definition.groups.flatMap((group) => group.params);
}

/** Every hardware-control assignment, in control order, as parameter keys. */
export function definitionKnobs(definition: ModuleDefinition): string[] {
  return definition.groups.flatMap((group) => group.knobs ?? []);
}
