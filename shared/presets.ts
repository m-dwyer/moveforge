/*
 * Resolving a preset against the declared parameter list.
 *
 * A preset used to have to spell out every parameter: gen-presets threw on a
 * missing key and validate-params reported it first. That is tolerable at 16
 * parameters and absurd at 64 — sixteen kits would be 1024 hand-authored numbers,
 * and every parameter added later means editing all sixteen presets before the
 * build goes green again.
 *
 * So a preset may now name only what it changes, and anything it omits takes the
 * parameter's declared default. That is not a new behaviour so much as a new
 * spelling of an existing one: the generated C is a dense `float[PARAM_COUNT]`
 * applied wholesale (`<id>_apply_preset`), so "omitted" and "explicitly equal to
 * the default" produce identical output, with no runtime or ABI change.
 *
 * The rule lives here because it has three consumers that must agree — the
 * generated C table, the offline render harness, and the browser's preset row. Two
 * of them disagreeing is a preset that sounds different in the browser than on the
 * device, which is the same failure the ui_hierarchy walk exists to prevent.
 */

/* Just the two fields resolution needs. Callers keep their own richer Param
 * types; see the note in ui-hierarchy.ts. */
export type PresetParam = {
  default: number;
  key: string;
};

/* What a preset is read from. `unknown` rather than `number` on purpose: this is
 * parsed JSON, so the type is a claim about the file, not a fact about it, and the
 * one thing this module must not do is quietly turn a typo into a number. */
export type DeclaredPresetParams = Record<string, unknown> | undefined;

export type ResolvedPresetValue = {
  key: string;
  value: number;
};

/* One parameter's value in a preset: what the preset says, or the parameter's
 * declared default when the preset does not mention it.
 *
 * Absent is inherited. Present-but-not-a-finite-number is an error, because it can
 * only be a mistake, and the alternative — falling back to the default — would make
 * `"tune": "36"` look like it worked. `label` names the preset in that message.
 *
 * Out-of-range values are deliberately passed through: the generated set_param
 * clamps them and validate-params reports them, so clamping here as well would
 * hide a preset the validator wants to complain about. */
export function presetValue(param: PresetParam, declared: DeclaredPresetParams, label: string): number {
  if (!declared || !(param.key in declared)) return param.default;

  const value = declared[param.key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(
      `${label}: param ${param.key} is ${JSON.stringify(value)}, which is not a finite number ` +
        `(omit the key to inherit its default of ${param.default})`
    );
  }
  return value;
}

/* Every declared parameter's value, in declaration order — the order the generated
 * enum counts in, so the array can be emitted as the dense C table directly. */
export function densePresetValues<P extends PresetParam>(
  params: P[],
  declared: DeclaredPresetParams,
  label: string
): ResolvedPresetValue[] {
  return params.map((param) => ({ key: param.key, value: presetValue(param, declared, label) }));
}

export type PresetLike = {
  name?: string;
  params?: Record<string, unknown>;
};

export type OmittedKeys = {
  keys: string[];
  name: string;
};

/* Presets that stop setting a key their predecessor set.
 *
 * The cost of sparse presets is that a forgotten block becomes invisible: leaving
 * out all eight of voice 5's parameters looks exactly like deciding voice 5 should
 * sit at its defaults. Comparing each preset against the one before it catches the
 * forgetful case without complaining about a deliberately minimal first preset,
 * which is the usual shape (`Init` first, then kits that build on it).
 *
 * Only declared keys count — an unknown key is already a validation error, and
 * warning about it here too would just be noise. */
export function keysDroppedFromPreviousPreset<P extends PresetParam>(
  presets: PresetLike[],
  params: P[]
): OmittedKeys[] {
  const declaredKeys = params.map((param) => param.key);
  const dropped: OmittedKeys[] = [];
  let previous: Set<string> | undefined;

  for (const [index, preset] of presets.entries()) {
    /* Not filtered to declared keys: the comparison below only ever asks about
     * declared ones, so filtering here as well would be a branch no test can
     * reach. */
    const present = new Set(Object.keys(preset.params ?? {}));
    if (previous) {
      const keys = declaredKeys.filter((key) => previous!.has(key) && !present.has(key));
      if (keys.length > 0) dropped.push({ keys, name: preset.name ?? `#${index}` });
    }
    previous = present;
  }
  return dropped;
}
