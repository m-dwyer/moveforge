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
 *
 * Every schema here is strict, which is the opposite of `module-schema.ts`'s
 * base and deliberately so. A target extends a parameter, so the *base* has to
 * pass unknown keys through or a round-trip would strip them. Nothing extends
 * the authored definition — so there, an unknown key is a typo, and because the
 * emitter spreads optional fields only when present, a typo is indistinguishable
 * from an absent field: `knob` for `knobs` silently ships a module.json with no
 * hardware controls and `mise run check` stays green. Strict turns each of those
 * into a parse error naming the key.
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
/**
 * A parameter as authored.
 *
 * `.strict()` keeps paramSchema's refinements and rejects unknown keys, so
 * `units` for `unit` fails here instead of being written through into the
 * module.json that ships. The loose base is still what targets extend.
 *
 * `display_format` is the one deliberate exception to this file's
 * target-neutrality. It is a Schwung field — a printf string for its snprintf —
 * but the emitter passes parameters through verbatim, so this is the only place
 * an author can set one. What is accepted here is only *a string*: the shape
 * (`%.2f`), the host's 15-byte buffer and the conflict with `unit: "%"` are
 * Schwung's rules and stay in `shared/targets/schwung.ts`, where a second target
 * will not inherit them.
 */
export const authoredParamSchema = paramSchema
  .safeExtend({ display_format: z.string().optional() })
  .strict();

export const paramGroupSchema = z.strictObject({
  /* Stable identifier for the bank. Distinct from `name`, which is a label:
   * "1 Hat" is what a performer reads, `hat` is what the tooling addresses. */
  key: z.string().min(1),
  knobs: z.array(z.string()).optional(),
  name: z.string().optional(),
  params: z.array(authoredParamSchema).default([])
});

/**
 * Which signals the module consumes and produces.
 *
 * Mostly implied by `kind`, but not entirely, so it is stated rather than
 * inferred: an effect that also listens to MIDI is an ordinary thing to want and
 * there is no way to derive it.
 */
export const moduleIoSchema = z
  .strictObject({
    audio_in: z.boolean(),
    audio_out: z.boolean(),
    midi_in: z.boolean(),
    /* What the MIDI it accepts *means*: true when the notes it wants are the
     * ones the instrument beside it is playing, false when they are a control
     * surface it reads as notes. `midi_in` cannot answer this — vca is a
     * note-gated amplifier, lobber's channel-0 notes are a pad grid, and both
     * set it. Required for the reason `chainable` is: a host must be able to
     * tell "declared false" from "did not say". */
    note_driven: z.boolean(),
    midi_out: z.boolean()
  })
  .refine((io) => !io.note_driven || io.midi_in, {
    error: "io.note_driven is set on a module that declares no midi_in"
  });

/**
 * A visualisation hint for the module's own screen. moveforge-local rather than
 * universal, but it describes the module's output, not any host's UI, so it is
 * authored here and each target decides whether it can honour it.
 */
export const scopeSchema = z.strictObject({
  mode: z.string().optional(),
  style: z.string().optional(),
  /* Sample count, so a fraction or a negative would reach the wrapper as
   * `#define <ID>_SCOPE_WINDOW -5` via gen-params' Math.round. */
  window: z.number().int().positive().optional()
});

/**
 * Wiring for a host-provided preset browser: the parameters that carry the
 * selected index, the count, and the name. Named parameters rather than a
 * boolean because the host addresses them by key.
 */
export const presetBrowseSchema = z.strictObject({
  count_param: z.string(),
  group: z.string(),
  list_param: z.string(),
  name_param: z.string()
});

export const moduleDefinitionSchema = z.strictObject({
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
})
  /* `preset_browse` points at a group by key, and that the target has to resolve
   * it says nothing about the target: a definition whose browse block names no
   * group is incoherent on its own terms. Checked here rather than in the
   * emitter, which stays a pure transform — and every target inherits it. */
  .refine((d) => !d.preset_browse || d.groups.some((g) => g.key === d.preset_browse!.group), {
    error: (issue) => {
      const d = issue.input as BrowseShape;
      return (
        `preset_browse.group "${d.preset_browse?.group}" names no group ` +
        `(have: ${d.groups.map((g) => g.key).join(", ")})`
      );
    }
  });

/* Just enough of the definition to phrase the message above. Spelled out rather
 * than reusing ModuleDefinition, which is inferred from the schema this sits on
 * and so cannot reference itself. */
type BrowseShape = { groups: { key: string }[]; preset_browse?: { group: string } };

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
 * Parameters with the group that declared them, in ABI order.
 *
 * The primitive; `definitionParams` is defined in terms of it so a caller that
 * wants the grouping — bank labels on the device, section headers in the browser
 * — cannot end up walking the definition a second, differently-ordered time to
 * get it. Same reasoning as `ui-hierarchy.ts`'s `paramGroups`, and for the same
 * reason: the flattened index *is* the parameter id.
 */
export function definitionGroups(definition: ModuleDefinition) {
  return definition.groups.map((group) => ({
    group: group.key,
    knobs: group.knobs ?? [],
    label: group.name,
    params: group.params
  }));
}

/**
 * Every parameter, in the order that is the ABI.
 *
 * That order reaches the generated C by a different route — through the emitted
 * `ui_hierarchy` and `flattenParams` — so the two must agree. They do by
 * construction, since the emitter writes one level per group in array order, and
 * `tests/module-definition.test.ts` asserts it against every real module rather
 * than leaving it to construction.
 */
export function definitionParams(definition: ModuleDefinition) {
  return definitionGroups(definition).flatMap((group) => group.params);
}

/** Every hardware-control assignment, in control order, as parameter keys. */
export function definitionKnobs(definition: ModuleDefinition): string[] {
  return definition.groups.flatMap((group) => group.knobs ?? []);
}
