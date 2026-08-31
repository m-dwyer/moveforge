/*
 * What a DSP module *is*, independent of what it is compiled for.
 *
 * A module is a set of parameters with musical semantics: a key, a name, a
 * type, a range, a default, a step, and a unit saying what the number means.
 * Nothing here knows about a host. Everything host-shaped — the file format a
 * particular runtime parses, its buffer sizes, its parameter-type vocabulary,
 * how it groups controls onto hardware — belongs to a target, and the only
 * target today is `shared/targets/schwung.ts`.
 *
 * The line to apply when deciding where a field goes: if it exists only because
 * something reads a file at runtime, it is target-level. `api_version`, the name
 * of the shared object, the chain-slot UI layout and the on-device display
 * format are all in that category. `unit` is not — "this parameter is a
 * percentage" is a fact about the parameter.
 *
 * This file is the companion to `ui-hierarchy.ts`: that one says what *order*
 * parameters come in, this one says what a parameter *is*. Before it existed,
 * eight files declared their own `type ModuleJson` and five their own
 * `type Param`, each a different subset, each reached by a `JSON.parse(...) as T`
 * that checked nothing at runtime.
 *
 * No `node:fs` here, deliberately: `shared/` is in the browser's bundle graph,
 * so this parses values someone else has read. The Node-side readers live in
 * `scripts/lib/modules.ts`.
 *
 * Scope: schemas own what is *intrinsic* to one object — field types, ranges,
 * enums. Anything relational is beyond what a schema can see and stays in
 * `scripts/validate-params.ts`: duplicate keys, preset values against their
 * parameter's range, randomize hints against that range, and every check that
 * reads the C or the .dsp.
 */
import { z } from "zod";

/**
 * How a parameter's value behaves.
 *
 * `float` is continuous, `int` and `enum` are discrete — `enum` additionally
 * means the integer indexes a list of names rather than counting anything. This
 * vocabulary is deliberately small; a target that supports fewer kinds narrows
 * it, and one that supports more maps the extras onto these.
 */
export const PARAM_TYPES = ["float", "int", "enum"] as const;

/**
 * What a parameter's number means, and therefore how it reads.
 *
 * `""` is the honest answer for a bare quantity — a ratio, a MIDI note, a
 * selector index — and is what a parameter gets by omitting the field.
 * `shared/param-format.ts` turns a value plus a unit into a display string.
 */
export const PARAM_UNITS = ["%", "dB", "Hz", "ms", "sec", "st", "BPM"] as const;

export const RANDOMIZE_MODES = ["around_default", "bounded", "full"] as const;

/* How a range is spread under the finger. Absent is an even spread. Declare
 * "exp" where the low end needs most of the travel, so a host turning a cutoff
 * over three decades does not lose the bottom four octaves in one detent. */
export const PARAM_TAPERS = ["exp"] as const;

const PARAM_KEY_RE = /^[a-z][a-z0-9_]*$/;

/**
 * One parameter.
 *
 * A loose object: unknown keys pass through untouched. That is load-bearing
 * rather than lazy — a target adds its own fields to a parameter (schwung's
 * `display_format`, for one), and a stripping schema would delete them on the
 * way through any tool that round-trips the file.
 */
export const paramSchema = z
  .looseObject({
    default: z.number({ error: "default is required and must be a number" }),
    key: z.string().regex(PARAM_KEY_RE, {
      error: (issue) => `param key ${JSON.stringify(issue.input)} must match /^[a-z][a-z0-9_]*$/`
    }),
    max: z.number({ error: "max is required and must be a number" }),
    min: z.number({ error: "min is required and must be a number" }),
    name: z.string().optional(),
    step: z.number().optional(),
    type: z.enum(PARAM_TYPES, {
      error: (issue) =>
        `type ${JSON.stringify(issue.input)} is not one of ${PARAM_TYPES.join(" | ")}`
    }),
    /* Free text rather than an enum of PARAM_UNITS: a unit nobody has a rule
     * for still reads correctly when it is appended verbatim, and rejecting
     * "V" or "cents" would be inventing a restriction no target imposes. */
    unit: z.string().optional(),
    taper: z.enum(PARAM_TAPERS).optional()
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
  /* A step of a whole unit or more means the control has settings, not a range,
   * and calling it continuous misdescribes it. Targets act on that: schwung
   * enrols float params in an audio-thread smoother and would ramp such a
   * control through every intermediate setting on the way. */
  /* An exponential taper works by ratio, so it needs a range above zero. */
  .refine((p) => !(p.taper === "exp" && p.min <= 0), {
    error: (issue) => {
      const p = issue.input as { min: number };
      return `taper "exp" needs min > 0, not ${p.min}`;
    }
  })
  .refine((p) => !(p.type === "float" && typeof p.step === "number" && p.step >= 1), {
    error: (issue) => {
      const p = issue.input as { step: number };
      return `step ${p.step} makes this a discrete control, so type must be "int" or "enum"`;
    }
  });

/* Preset values stay `unknown` on purpose. Resolving one is `presetValue()`'s
 * job (shared/presets.ts) — the rule shared by the generated C, the render
 * harness and the browser — and it already rejects a non-finite value with a
 * message naming the preset. */
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

export type Param = z.infer<typeof paramSchema>;
export type ParamType = (typeof PARAM_TYPES)[number];
export type ParamUnit = (typeof PARAM_UNITS)[number];
export type ParamTaper = (typeof PARAM_TAPERS)[number];
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
 * uses to find the offending object in a 19KB file. */
function formatPath(path: readonly PropertyKey[]): string {
  return path
    .map((segment) => (typeof segment === "number" ? `[${segment}]` : String(segment)))
    .join(".")
    .replace(/\.\[/g, "[");
}

/** Parse against a schema, raising the issues as one ModuleSchemaError. */
export function parseWith<T>(schema: z.ZodType<T>, value: unknown, source: string): T {
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

/** UTF-8 byte length. Targets with fixed buffers measure in bytes, not characters. */
export function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
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
