/*
 * The Schwung target: what a module has to look like for the Schwung host on
 * Ableton Move to load it.
 *
 * `shared/module-schema.ts` describes a module in the abstract. This file adds
 * everything that exists only because the Schwung host reads a file at runtime:
 * the `module.json` layout, its `capabilities` block, the chain-slot UI
 * hierarchy, the on-device display format, and the fixed buffers the parser
 * memcpys into.
 *
 * Every constraint here is a fact about schwung 0.11.4, cited to the source in
 * `upstream/schwung` (or `../overture/schwung`). None of it should leak back
 * into the core: a CLAP or VST target would emit a C descriptor table and no
 * manifest at all, and would inherit none of this.
 *
 * What is *not* here, deliberately: the relational checks that need more than
 * one object at a time — duplicate keys across levels, the 65536-byte file
 * limit, the param count against MAX_CHAIN_PARAMS. Those need the whole
 * document plus its size on disk, and live in `scripts/validate-params.ts`
 * with the same citations.
 */
import { z } from "zod";

import { paramSchema, parseWith, utf8Bytes } from "../module-schema.ts";

/**
 * The component kinds the host will load. `parse_param_object` returns -1 for
 * anything else, which fails `parse_chain_params` and makes the host reject the
 * whole module — it installs and verifies clean, then simply does not load.
 */
export const COMPONENT_TYPES = [
  "sound_generator",
  "audio_fx",
  "midi_fx",
  "utility",
  "tool",
  "overtake"
] as const;

/* chain_internal.h:111-112 — `char unit[16]` and `char display_format[16]`.
 * Bytes, not characters: the parser memcpys raw JSON bytes and truncates
 * silently, so an over-long unit becomes a different unit with no error. */
const MAX_UNIT_BYTES = 15;
const MAX_DISPLAY_FORMAT_BYTES = 15;

/* The only shape both of the host's formatters accept. The shadow UI parses
 * display_format with /^%?\.(\d{1,2})(f|%)$/ (src/shared/param_format.mjs), and
 * the chain host passes it to snprintf against a float (chain_params.c:41), so
 * a "%d" would be undefined behaviour rather than a rounding choice. */
const DISPLAY_FORMAT_RE = /^%?\.\d{1,2}[f%]$/;

/**
 * A parameter as Schwung reads it: the core parameter plus the host's own
 * display fields, and the host's limits on all of them.
 */
export const schwungParamSchema = paramSchema
  .safeExtend({
    display_format: z
      .string()
      .regex(DISPLAY_FORMAT_RE, {
        error: (issue) =>
          `display_format ${JSON.stringify(issue.input)} must look like "%.2f" or "%.0%" — ` +
          `the device passes it to snprintf against a float and the shadow UI only parses that shape`
      })
      .refine((value) => utf8Bytes(value) <= MAX_DISPLAY_FORMAT_BYTES, {
        error: `display_format is longer than the host's ${MAX_DISPLAY_FORMAT_BYTES}-byte buffer`
      })
      .optional()
  })
  .refine((p) => p.unit === undefined || utf8Bytes(p.unit) <= MAX_UNIT_BYTES, {
    error: `unit is longer than the host's ${MAX_UNIT_BYTES}-byte buffer, and the host truncates silently`
  })
  /* `%` is the one unit the host's two formatters scale themselves, and they
   * disagree about display_format on top of it. Measured against schwung's own
   * src/shared/param_format.mjs with {unit:"%", max:1, display_format:"%.0f"}:
   * the shadow UI renders 0.35 as "0", because it applies the format to the raw
   * value and returns before the percent branch that would have scaled it. The
   * chain host does the opposite — scales then formats — and shows "35 %".
   * Spelling it "%.0%" fixes the shadow UI and makes the host's snprintf
   * undefined, since "%.0%" is not a conversion.
   *
   * There is no spelling that is right in both, so the combination is rejected.
   * `unit: "%"` alone is correct in both. Upstream's own freeverb ships the
   * broken pairing on all four of its parameters, which is why this is worth
   * catching rather than assuming nobody would write it. */
  .refine((p) => !(p.unit === "%" && p.display_format !== undefined), {
    error:
      `a param with unit "%" must not also set display_format — the shadow UI would ` +
      `render the raw value (0.35 as "0") while the device shows "35 %". Drop ` +
      `display_format and let each formatter scale.`
  });

export const uiHierarchyLevelSchema = z.looseObject({
  knobs: z.array(z.string()).optional(),
  name: z.string().optional(),
  params: z.array(schwungParamSchema).optional()
});

export const uiHierarchySchema = z.looseObject({
  levels: z.record(z.string(), uiHierarchyLevelSchema).optional(),
  shared_params: z.array(schwungParamSchema).optional()
});

/* moveforge-local rather than a host field: gen-params turns this into the
 * wrapper's MF_SCOPE_* macros. style/mode are validated against the generator's
 * lookup tables rather than an enum here, because that generator warns and
 * falls back rather than failing — see renderScopeInc. */
export const scopeSchema = z.looseObject({
  mode: z.string().optional(),
  style: z.string().optional(),
  window: z.number().optional()
});

export const capabilitiesSchema = z.looseObject({
  audio_in: z.boolean().optional(),
  audio_out: z.boolean().optional(),
  /* Required rather than optional: absent and false mean the same thing to the
   * host and different things to a reader. */
  chainable: z.boolean({ error: "capabilities.chainable is not set (an explicit true/false is required)" }),
  component_type: z.enum(COMPONENT_TYPES),
  midi_in: z.boolean().optional(),
  midi_out: z.boolean().optional(),
  /* Optional here and required in the authored definition: a manifest this repo
   * did not emit may predate the field. */
  note_driven: z.boolean().optional(),
  scope: scopeSchema.optional(),
  ui_hierarchy: uiHierarchySchema.optional()
});

export const schwungModuleJsonSchema = z.looseObject({
  /* Shown in the chain slot, where there is room for very little. */
  abbrev: z.string().min(3, { error: "abbrev must be 3-6 characters" }).max(6, {
    error: "abbrev must be 3-6 characters"
  }),
  api_version: z.number().optional(),
  capabilities: capabilitiesSchema,
  id: z.string(),
  name: z.string().optional(),
  ui: z.string().optional(),
  ui_chain: z.string().optional()
});

export type SchwungParam = z.infer<typeof schwungParamSchema>;
export type UiHierarchyLevelJson = z.infer<typeof uiHierarchyLevelSchema>;
export type UiHierarchyJson = z.infer<typeof uiHierarchySchema>;
export type ScopeConfig = z.infer<typeof scopeSchema>;
export type SchwungCapabilities = z.infer<typeof capabilitiesSchema>;
export type SchwungModuleJson = z.infer<typeof schwungModuleJsonSchema>;

export function parseSchwungModuleJson(value: unknown, source: string): SchwungModuleJson {
  return parseWith(schwungModuleJsonSchema, value, source);
}
