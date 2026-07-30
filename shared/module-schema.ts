/*
 * The one description of what a module's JSON files *are*.
 *
 * `ui-hierarchy.ts` owns the walk over `capabilities.ui_hierarchy` and says so:
 * it orders parameters, it does not describe them. Nothing owned the
 * description, so eight files declared their own `type ModuleJson` and five
 * their own `type Param`, each a different subset, each reached by a
 * `JSON.parse(...) as T` that checked nothing at runtime. A field one generator
 * depended on was validated by none of the others, and a malformed file
 * surfaced as a TypeError somewhere downstream rather than as a diagnostic.
 *
 * This file is the missing half: `ui-hierarchy.ts` says what order parameters
 * come in, this says what a parameter is. Callers still instantiate the
 * hierarchy generic themselves — `UiHierarchy<ModuleParam>` — so that file stays
 * free of the union of everyone's fields.
 *
 * No `node:fs` here, deliberately: `shared/` is in the browser's bundle graph
 * (`web/src/module-metadata.ts` imports ui-hierarchy from it), so this module
 * parses values that someone else has read. The Node-side readers live in
 * `scripts/lib/modules.ts`.
 *
 * Scope: this schema owns the *intrinsic* shape of one object — field types,
 * ranges, enums. It deliberately does not own anything relational, because a
 * schema cannot see across files or across parameters. Duplicate keys, UTF-8
 * byte limits, preset values against their parameter's range, randomize hints
 * against that range, and every check that reads the C or the .dsp stay in
 * `scripts/validate-params.ts`, which has the citations to justify them.
 */
import { z } from "zod";

/* The host accepts exactly these (schwung 0.11.4, chain_params.c:206-214). */
export const HOST_PARAM_TYPES = ["float", "int", "enum"] as const;

export const COMPONENT_TYPES = [
  "sound_generator",
  "audio_fx",
  "midi_fx",
  "utility",
  "tool",
  "overtake"
] as const;

export const RANDOMIZE_MODES = ["around_default", "bounded", "full"] as const;

const PARAM_KEY_RE = /^[a-z][a-z0-9_]*$/;

/*
 * Every object here is a *loose* object: unknown keys pass through untouched.
 *
 * That is not laziness about the schema, it is a property module.json needs.
 * The file ships to the device and the host reads fields this repo does not
 * model yet — `unit` and `display_format` are parsed at chain_params.c:262-290
 * and drive on-device value formatting. A stripping schema would silently
 * delete them on the way through any tool that round-trips the file, and a
 * strict one would reject a module.json the host is perfectly happy with.
 */
export const moduleParamSchema = z
  .looseObject({
    default: z.number({ error: "default is required and must be a number" }),
    key: z.string().regex(PARAM_KEY_RE, {
      error: (issue) => `param key ${JSON.stringify(issue.input)} must match /^[a-z][a-z0-9_]*$/`
    }),
    max: z.number({ error: "max is required and must be a number" }),
    min: z.number({ error: "min is required and must be a number" }),
    name: z.string().optional(),
    step: z.number().optional(),
    type: z.enum(HOST_PARAM_TYPES, {
      error: (issue) =>
        `type ${JSON.stringify(issue.input)} is not one of ${HOST_PARAM_TYPES.join(" | ")} — ` +
        `the host rejects the entire module rather than just this param`
    })
  })
  .refine((p) => p.min < p.max, {
    error: (issue) => {
      const p = issue.input as { max: number; min: number };
      return `min ${p.min} must be < max ${p.max}`;
    }
  })
  .refine((p) => p.default >= p.min && p.default <= p.max, {
    error: (issue) => {
      const p = issue.input as { default: number; max: number; min: number };
      return `default ${p.default} outside [${p.min}, ${p.max}]`;
    }
  })
  /* A discrete control declared "float" gets enrolled in the host's audio-thread
   * smoother and ramped through intermediate values over ~90ms, so e.g. a sync
   * division sweeps through every setting on the way. */
  .refine((p) => !(p.type === "float" && typeof p.step === "number" && p.step >= 1), {
    error: (issue) => {
      const p = issue.input as { step: number };
      return (
        `step ${p.step} makes this a discrete control, so type must be "int" or "enum" — ` +
        `the host smooths float params on the audio thread and would ramp it through ` +
        `intermediate values`
      );
    }
  });

export const uiHierarchyLevelSchema = z.looseObject({
  knobs: z.array(z.string()).optional(),
  name: z.string().optional(),
  params: z.array(moduleParamSchema).optional()
});

export const uiHierarchySchema = z.looseObject({
  levels: z.record(z.string(), uiHierarchyLevelSchema).optional(),
  shared_params: z.array(moduleParamSchema).optional()
});

/* moveforge-local, not a host field: gen-params turns this into the wrapper's
 * MF_SCOPE_* macros. The style/mode strings are validated against the generator's
 * lookup tables rather than an enum here, because that generator warns and falls
 * back rather than failing — see renderScopeInc. */
export const scopeSchema = z.looseObject({
  mode: z.string().optional(),
  style: z.string().optional(),
  window: z.number().optional()
});

export const capabilitiesSchema = z.looseObject({
  audio_in: z.boolean().optional(),
  audio_out: z.boolean().optional(),
  /* Required rather than optional: the scaffold sets it explicitly and the
   * skill asks for an explicit answer, because "absent" and "false" mean the
   * same thing to the host and different things to a reader. */
  chainable: z.boolean({ error: "capabilities.chainable is not set (an explicit true/false is required)" }),
  component_type: z.enum(COMPONENT_TYPES),
  midi_in: z.boolean().optional(),
  midi_out: z.boolean().optional(),
  scope: scopeSchema.optional(),
  ui_hierarchy: uiHierarchySchema.optional()
});

export const moduleJsonSchema = z.looseObject({
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

/* Preset values stay `unknown` on purpose. Resolving one is `presetValue()`'s
 * job (shared/presets.ts) — it is the rule shared by the generated C, the render
 * harness and the browser, and it already rejects a non-finite value with a
 * message naming the preset. Duplicating that as a schema type would give two
 * answers to one question. */
export const presetSchema = z.looseObject({
  name: z.string(),
  params: z.record(z.string(), z.unknown()).optional()
});

export const presetsJsonSchema = z.looseObject({
  module_id: z.string().optional(),
  presets: z.array(presetSchema).optional()
});

export const randomizeHintSchema = z.looseObject({
  amount: z
    .number()
    .gt(0, { error: "amount must be > 0 and <= 1" })
    .lte(1, { error: "amount must be > 0 and <= 1" })
    .optional(),
  max: z.number().optional(),
  min: z.number().optional(),
  mode: z.enum(RANDOMIZE_MODES).optional()
});

export const metadataJsonSchema = z.looseObject({
  params: z.record(z.string(), z.string()).optional(),
  randomize: z.record(z.string(), randomizeHintSchema).optional()
});

export const moduleIndexSchema = z.looseObject({
  modules: z
    .array(z.looseObject({ id: z.string(), kind: z.string().optional(), name: z.string().optional() }))
    .optional()
});

export type ModuleParam = z.infer<typeof moduleParamSchema>;
export type ScopeConfig = z.infer<typeof scopeSchema>;
export type UiHierarchyLevelJson = z.infer<typeof uiHierarchyLevelSchema>;
export type UiHierarchyJson = z.infer<typeof uiHierarchySchema>;
export type ModuleCapabilities = z.infer<typeof capabilitiesSchema>;
export type ModuleJson = z.infer<typeof moduleJsonSchema>;
export type Preset = z.infer<typeof presetSchema>;
export type PresetsJson = z.infer<typeof presetsJsonSchema>;
export type RandomizeHint = z.infer<typeof randomizeHintSchema>;
export type MetadataJson = z.infer<typeof metadataJsonSchema>;
export type ModuleIndexJson = z.infer<typeof moduleIndexSchema>;

/** One structural problem, in the shape validate-params.ts reports. */
export type SchemaIssue = {
  code: string;
  message: string;
  /** Dotted path into the document, e.g. `capabilities.ui_hierarchy.levels.root.params[3].min`. */
  path: string;
};

export class ModuleSchemaError extends Error {
  readonly issues: readonly SchemaIssue[];
  readonly source: string;

  constructor(source: string, issues: readonly SchemaIssue[]) {
    super(`${source}: ${issues.map((issue) => `${issue.path || "<root>"}: ${issue.message}`).join("; ")}`);
    this.name = "ModuleSchemaError";
    this.issues = issues;
    this.source = source;
  }
}

/* Array indices read better as [3] than .3, and the path is the part a reader
 * uses to find the offending object in a 17KB file. */
function formatPath(path: readonly PropertyKey[]): string {
  return path
    .map((segment) => (typeof segment === "number" ? `[${segment}]` : String(segment)))
    .join(".")
    .replace(/\.\[/g, "[");
}

function parseWith<T>(schema: z.ZodType<T>, value: unknown, source: string): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new ModuleSchemaError(
    source,
    result.error.issues.map((issue) => ({
      code: issue.code,
      message: issue.message,
      path: formatPath(issue.path)
    }))
  );
}

export function parseModuleJson(value: unknown, source: string): ModuleJson {
  return parseWith(moduleJsonSchema, value, source);
}

export function parsePresetsJson(value: unknown, source: string): PresetsJson {
  return parseWith(presetsJsonSchema, value, source);
}

export function parseMetadataJson(value: unknown, source: string): MetadataJson {
  return parseWith(metadataJsonSchema, value, source);
}

export function parseModuleIndex(value: unknown, source: string): ModuleIndexJson {
  return parseWith(moduleIndexSchema, value, source);
}
