import { readFile, stat } from "node:fs/promises";
import { modulePaths, selectedModuleIds } from "./lib/modules.ts";
import { generate as genParams } from "./gen-params.ts";

type Param = {
  default: number;
  key: string;
  max: number;
  min: number;
  name?: string;
  step?: number;
  type: string;
};

type Capabilities = {
  audio_in?: boolean;
  audio_out?: boolean;
  chainable?: boolean;
  component_type?: string;
  midi_in?: boolean;
  midi_out?: boolean;
  ui_hierarchy?: {
    levels?: {
      [level: string]: {
        knobs?: string[];
        name?: string;
        params?: Param[];
      } | undefined;
      root?: {
        knobs?: string[];
        name?: string;
        params?: Param[];
      };
    };
    shared_params?: Param[];
  };
};

type ModuleJson = {
  abbrev?: string;
  api_version?: number;
  capabilities?: Capabilities;
  id: string;
  name?: string;
  ui?: string;
  ui_chain?: string;
};

type PresetsJson = {
  presets?: Array<{
    name: string;
    params?: Record<string, number>;
  }>;
};

type MetadataJson = {
  params?: Record<string, string>;
  randomize?: Record<string, {
    amount?: number;
    max?: number;
    min?: number;
    mode?: string;
  }>;
};

type ValidationGroup = {
  errors: string[];
  moduleId: string;
};

const HOST_PARAM_TYPES = ["float", "int", "enum"];
const VALID_COMPONENT_TYPES = new Set([
  "sound_generator",
  "audio_fx",
  "midi_fx",
  "utility",
  "tool",
  "overtake"
]);
const VALID_RANDOMIZE_MODES = new Set(["around_default", "bounded", "full"]);
/* One buildUserInterface registration in the *generated* Faust C:
 *   ui_interface->addHorizontalSlider(ui_interface->uiInterface, "drive",
 *       &dsp->fHslider6, (FAUSTFLOAT)0.15f, (FAUSTFLOAT)0.0f, …);
 * See validateFaustSliders for why this is read instead of the .dsp. */
const FAUST_UI_RE =
  /add(?:HorizontalSlider|VerticalSlider|NumEntry)\s*\([^,]*,\s*"([^"]*)"\s*,[^,]*,([^;]*)\)\s*;/g;
const FAUST_UI_TOGGLE_RE = /add(?:CheckButton|Button)\s*\([^,]*,\s*"([^"]*)"\s*,[^;]*\)\s*;/g;
/* Schwung chain-host limits — see validateHostLimits for provenance. */
const HOST_MAX_KEY_CHARS = 31;
const HOST_MAX_NAME_CHARS = 63;
const HOST_MAX_PARAMS = 256;
const HOST_MAX_MODULE_JSON_BYTES = 65536;

const moduleIds = await selectedModuleIds();
const allErrors: ValidationGroup[] = [];

/* Whether a generated file is stale is the generator's own question, and it
 * can answer it exactly by re-rendering and byte-comparing. This used to be
 * re-derived here by searching the output for each param's enum line, which
 * could not see a stale clamp, a stale count, or the .gen.h at all. Running
 * gen-params in check mode replaces all of that; it is a no-op second run when
 * validate.ts has already called it. */
if ((await genParams({ mode: "check", moduleIds })) > 0) {
  allErrors.push({
    moduleId: "generated params",
    errors: ["generated param files are stale — run `mise run gen-params`"]
  });
}

await validateIndex(moduleIds);

for (const moduleId of moduleIds) {
  const errors: string[] = [];
  await validateModule(moduleId, errors);
  if (errors.length) allErrors.push({ moduleId, errors });
}

if (allErrors.length) {
  console.error("Module validation failed:");
  for (const { moduleId, errors } of allErrors) {
    console.error(`\n${moduleId}:`);
    for (const error of errors) console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Validated ${moduleIds.length} module(s): ${moduleIds.join(", ")}`);

async function validateIndex(moduleIds: string[]): Promise<void> {
  if (process.env.MODULE_ID) return;
  const index = await readJson<{ modules?: Array<{ id: string }> }>("src/modules/index.json");
  const indexed = (index.modules || []).map((item) => item.id).sort();
  const missing = moduleIds.filter((id) => !indexed.includes(id));
  const stale = indexed.filter((id) => !moduleIds.includes(id));
  const errors = [];
  for (const id of missing) errors.push(`src/modules/index.json missing module ${id}`);
  for (const id of stale) errors.push(`src/modules/index.json references missing module ${id}`);
  if (errors.length) allErrors.push({ moduleId: "module index", errors });
}

async function validateModule(moduleId: string, errors: string[]): Promise<void> {
  const paths = modulePaths(moduleId);
  const moduleJson = await readJson<ModuleJson>(paths.moduleJson);
  const metadataJson = await readJson<MetadataJson>(`${paths.moduleDir}/metadata.json`).catch(() => ({}));
  const presetsJson = await readJson<PresetsJson>(paths.presets).catch(() => ({ presets: [] }) as PresetsJson);

  if (moduleJson.id !== moduleId) {
    errors.push(`module.json id ${moduleJson.id} does not match directory ${moduleId}`);
  }

  if (typeof moduleJson.abbrev !== "string") {
    errors.push(`module.json abbrev is missing`);
  } else if (moduleJson.abbrev.length < 3 || moduleJson.abbrev.length > 6) {
    errors.push(`module.json abbrev "${moduleJson.abbrev}" must be 3-6 characters`);
  }

  const caps = moduleJson.capabilities;
  if (!caps) {
    errors.push(`module.json is missing capabilities block`);
    return;
  }
  if (!caps.component_type) {
    errors.push(`module.json capabilities.component_type is missing`);
  } else if (!VALID_COMPONENT_TYPES.has(caps.component_type)) {
    errors.push(`unknown component_type "${caps.component_type}"`);
  }
  if (caps.chainable === undefined) {
    errors.push(`module.json capabilities.chainable is not set (skill recommends explicit true/false)`);
  }

  validateHostLimits(moduleJson, (await stat(paths.moduleJson)).size, errors);

  if (moduleJson.ui_chain && !(await fileExists(`${paths.moduleDir}/${moduleJson.ui_chain}`))) {
    errors.push(`ui_chain "${moduleJson.ui_chain}" referenced but file missing`);
  }

  /* The host drives the solo screen by calling globalThis.init/tick. It never
   * imports a named export, so a ui.js that only exports functions is never
   * called and the screen is simply blank — with no error anywhere. */
  if (moduleJson.ui) {
    const uiPath = `${paths.moduleDir}/${moduleJson.ui}`;
    if (!(await fileExists(uiPath))) {
      errors.push(`ui "${moduleJson.ui}" referenced but file missing`);
    } else {
      const ui = await readFile(uiPath, "utf8");
      for (const hook of ["init", "tick"]) {
        if (!new RegExp(`globalThis\\s*\\.\\s*${hook}\\s*=`).test(ui)) {
          errors.push(
            `${moduleJson.ui} never assigns globalThis.${hook} — the host calls that to drive ` +
              `the solo screen, so the module's screen would stay blank`
          );
        }
      }
    }
  }

  const params = caps.ui_hierarchy?.levels?.root?.params;
  if (params) {
    validateParams(moduleId, params, errors);
    validateSoundGeneratorLevelParams(caps.component_type, params, errors);
    validatePresets(presetsJson, params, errors);
    await validatePresetsAreExposed(moduleId, presetsJson, errors);
    validateMetadata(moduleId, metadataJson, params, errors);
    const coreHeader = await readFile(paths.coreHeader, "utf8");
    validateCoreStruct(moduleId, params, coreHeader, errors);
    validateParamCountNotRedefined(moduleId, coreHeader, errors);
    if (await fileExists(paths.faustDsp)) {
      validateFaustSliders(
        params,
        await readFile(paths.faustDsp, "utf8"),
        await readFile(paths.faustC, "utf8").catch(() => ""),
        errors
      );
    }
    const knobs = caps.ui_hierarchy?.levels?.root?.knobs || [];
    const paramKeys = new Set(params.map((p) => p.key));
    for (const key of knobs) {
      if (!paramKeys.has(key)) errors.push(`knob ${key} is not a declared param`);
    }
  } else if (caps.component_type === "sound_generator" || caps.component_type === "audio_fx") {
    errors.push(`module.json is missing capabilities.ui_hierarchy.levels.root.params`);
  }
}

/* Hard limits enforced by the Schwung chain host when it parses module.json.
 * Every one of these fails at *load* time on the device with no local symptom:
 * the module installs, verifies clean, and then simply does not appear.
 *
 * Verified against schwung 0.11.4, src/modules/chain/dsp/:
 *   chain_internal.h:101  MAX_CHAIN_PARAMS 256
 *   chain_params.c:173,189  parse_param_object truncates key at
 *     sizeof(param->key)-1 = 31 and name at sizeof(param->name)-1 = 63. This
 *     is the path every module here takes: parse_chain_params tries
 *     ui_hierarchy first (:574-594) and falls through to the legacy
 *     chain_params array — which does clamp both to 31 (:645,660) — only when
 *     ui_hierarchy is absent or yields no inline params.
 *   chain_params.c:561,774  module.json is rejected at > 65536 by
 *     parse_chain_params and at >= 65536 by parse_ui_hierarchy_cache, which
 *     serves the FX and midi-FX slots; >= is the tightest true bound
 *   chain_params.c:446-491  shared_params objects are parsed into the SAME
 *     array as the levels, sharing the duplicate check and the 256 cap
 *   chain_params.c:531-541  a duplicate key across ANY two levels makes
 *     parse_chain_params return -1, which rejects the whole module
 * Truncation is silent, so an over-long key becomes a key the module itself
 * does not answer to — a dead knob rather than an error. */
function validateHostLimits(moduleJson: ModuleJson, jsonBytes: number, errors: string[]): void {
  if (jsonBytes >= HOST_MAX_MODULE_JSON_BYTES) {
    errors.push(
      `module.json is ${jsonBytes} bytes — the host refuses to read it at ` +
        `>= ${HOST_MAX_MODULE_JSON_BYTES} and the module will not load`
    );
  }

  const hierarchy = moduleJson.capabilities?.ui_hierarchy;
  const seen = new Map<string, string>();
  let total = 0;

  /* shared_params lands in the same array as the levels, so it counts toward
   * the cap and collides with level keys. Walking only `levels` left a
   * duplicate there passing validation and rejecting the module on device. */
  const groups: Array<[string, Param[]]> = [
    ...Object.entries(hierarchy?.levels ?? {}).map(
      ([name, level]) => [`levels.${name}`, level?.params ?? []] as [string, Param[]]
    ),
    ["shared_params", hierarchy?.shared_params ?? []]
  ];

  for (const [groupName, groupParams] of groups) {
    for (const param of groupParams) {
      total++;
      if (typeof param.key === "string") {
        /* Bytes, not JS string length: the host memcpys raw JSON bytes, so a
         * 31-character multi-byte name is well past its buffer. */
        const keyBytes = Buffer.byteLength(param.key, "utf8");
        if (keyBytes > HOST_MAX_KEY_CHARS) {
          errors.push(
            `param ${param.key}: key is ${keyBytes} bytes — the host truncates keys at ` +
              `${HOST_MAX_KEY_CHARS}, so it would look up a key this module does not answer to`
          );
        }
        /* The host dedupes across every level, not per level. */
        const previous = seen.get(param.key);
        if (previous !== undefined) {
          errors.push(
            `param key "${param.key}" appears in both ${previous} and ${groupName} — ` +
              `a duplicate key anywhere in ui_hierarchy makes the host reject the entire module`
          );
        } else {
          seen.set(param.key, groupName);
        }
      }
      if (typeof param.name === "string") {
        const nameBytes = Buffer.byteLength(param.name, "utf8");
        if (nameBytes > HOST_MAX_NAME_CHARS) {
          errors.push(
            `param ${param.key}: name "${param.name}" is ${nameBytes} bytes — the host ` +
              `truncates display names at ${HOST_MAX_NAME_CHARS}`
          );
        }
      }
    }
  }

  if (total > HOST_MAX_PARAMS) {
    errors.push(
      `${total} params across all ui_hierarchy levels and shared_params exceeds the host's ` +
        `MAX_CHAIN_PARAMS (${HOST_MAX_PARAMS})`
    );
  }
}

function validateSoundGeneratorLevelParams(componentType: string | undefined, params: Param[], errors: string[]): void {
  if (componentType !== "sound_generator") return;
  for (const param of params) {
    if (!/^(volume|level)$/i.test(param.key)) continue;
    if (param.min !== 0) {
      errors.push(`sound generator param ${param.key}: min must be 0 so stress renders can treat it as silence-capable`);
    }
  }
}

function validateMetadata(moduleId: string, metadataJson: MetadataJson, params: Param[], errors: string[]): void {
  const paramKeys = new Set(params.map((p) => p.key));
  const paramByKey = new Map(params.map((p) => [p.key, p]));
  for (const key of Object.keys(metadataJson.params || {})) {
    if (!paramKeys.has(key)) errors.push(`metadata.json params.${key} is not a declared param`);
  }

  const randomize = metadataJson.randomize || {};
  for (const param of params) {
    if (!randomize[param.key]) {
      errors.push(`metadata.json randomize.${param.key} is missing`);
    }
  }
  for (const [key, hint] of Object.entries(randomize)) {
    const param = paramByKey.get(key);
    if (!param) {
      errors.push(`metadata.json randomize.${key} is not a declared param`);
      continue;
    }
    if (hint.mode !== undefined && !VALID_RANDOMIZE_MODES.has(hint.mode)) {
      errors.push(`metadata.json randomize.${key}.mode must be around_default, bounded, or full`);
    }
    const min = hint.min;
    const max = hint.max;
    if (min !== undefined && typeof min !== "number") errors.push(`metadata.json randomize.${key}.min must be a number`);
    if (max !== undefined && typeof max !== "number") errors.push(`metadata.json randomize.${key}.max must be a number`);
    if (typeof min === "number" && (min < param.min || min > param.max)) {
      errors.push(`metadata.json randomize.${key}.min ${min} outside param range [${param.min}, ${param.max}]`);
    }
    if (typeof max === "number" && (max < param.min || max > param.max)) {
      errors.push(`metadata.json randomize.${key}.max ${max} outside param range [${param.min}, ${param.max}]`);
    }
    if (typeof min === "number" && typeof max === "number" && min >= max) {
      errors.push(`metadata.json randomize.${key}: min ${min} must be < max ${max}`);
    }
    if (hint.amount !== undefined && (typeof hint.amount !== "number" || hint.amount <= 0 || hint.amount > 1)) {
      errors.push(`metadata.json randomize.${key}.amount must be > 0 and <= 1`);
    }
  }
}

function validateParams(moduleId: string, params: Param[], errors: string[]): void {
  const seen = new Set<string>();
  for (const p of params) {
    if (!p.key) {
      errors.push(`param is missing key`);
      continue;
    }
    if (!/^[a-z][a-z0-9_]*$/.test(p.key)) {
      errors.push(`param key "${p.key}" must match /^[a-z][a-z0-9_]*$/`);
    }
    if (seen.has(p.key)) errors.push(`duplicate param key "${p.key}"`);
    seen.add(p.key);
    /* The host accepts exactly float | int | enum (chain_params.c:206-214).
     * Anything else makes parse_param_object return -1, which fails
     * parse_chain_params, which makes the host reject the whole module — it
     * installs and verifies clean and then simply does not load. Note our own
     * gen-ui-chain happily accepts "bool" as a discrete type, so this is a real
     * trap rather than a theoretical one. */
    if (!p.type) {
      errors.push(`param ${p.key} missing type`);
    } else if (!HOST_PARAM_TYPES.includes(p.type)) {
      errors.push(
        `param ${p.key}: type "${p.type}" is not one of ${HOST_PARAM_TYPES.join(" | ")} — ` +
          `the host rejects the entire module rather than just this param`
      );
    }
    /* A discrete control declared "float" gets enrolled in the host's
     * audio-thread smoother and ramped through intermediate values over ~90ms,
     * so e.g. a sync division sweeps through every setting on the way. */
    if (p.type === "float" && typeof p.step === "number" && p.step >= 1) {
      errors.push(
        `param ${p.key}: step ${p.step} makes this a discrete control, so type must be ` +
          `"int" or "enum" — the host smooths float params on the audio thread and would ` +
          `ramp it through intermediate values`
      );
    }
    if (typeof p.min !== "number" || typeof p.max !== "number") {
      errors.push(`param ${p.key} missing min/max`);
      continue;
    }
    if (p.min >= p.max) errors.push(`param ${p.key}: min ${p.min} must be < max ${p.max}`);
    if (typeof p.default !== "number") {
      errors.push(`param ${p.key} missing default`);
    } else if (p.default < p.min || p.default > p.max) {
      errors.push(`param ${p.key}: default ${p.default} outside [${p.min}, ${p.max}]`);
    }
  }
}

function validatePresets(presetsJson: PresetsJson, params: Param[], errors: string[]): void {
  const paramKeys = new Set(params.map((p) => p.key));
  const paramByKey = new Map(params.map((p) => [p.key, p]));
  for (const preset of presetsJson.presets || []) {
    const presetKeys = Object.keys(preset.params || {});
    for (const key of presetKeys) {
      if (!paramKeys.has(key)) errors.push(`preset ${preset.name} uses unknown param ${key}`);
    }
    for (const param of params) {
      if (!(param.key in (preset.params || {}))) {
        errors.push(`preset ${preset.name} is missing param ${param.key}`);
      }
      const value = preset.params?.[param.key];
      if (typeof value === "number") {
        const p = paramByKey.get(param.key)!;
        if (value < p.min || value > p.max) {
          errors.push(`preset ${preset.name} param ${param.key}=${value} outside [${p.min}, ${p.max}]`);
        }
      }
    }
  }
}

/* Opt-outs, declared in the .dsp itself so the intent travels with the source:
 *   // moveforge-adapter-controls: gate, freq, gain
 *       sliders the C adapter drives directly; not module.json params.
 *   // moveforge-adapter-params: time, sync
 *       module.json params the adapter computes rather than mapping 1:1. */
function declaredExemptions(dsp: string, tag: string): Set<string> {
  const names = new Set<string>();
  for (const [, list] of dsp.matchAll(new RegExp(`//\\s*moveforge-${tag}\\s*:([^\\n]*)`, "g"))) {
    for (const name of list.split(",").map((s) => s.trim()).filter(Boolean)) names.add(name);
  }
  return names;
}

/* The adapter captures a Faust zone by matching the control's label against
 * <id>_param_id(). A label that does not match any module.json key returns -1,
 * so the zone is never captured and push_params_to_faust skips it forever: a
 * knob that compiles, validates, renders and ships while doing nothing.
 *
 * Read from the *generated* <id>_faust.c rather than the .dsp, because the
 * Faust compiler has already answered every hard part: metadata
 * (`"cutoff [style:knob]"`) and group paths (`"h:Filter/cutoff"`) are stripped
 * to the bare label the adapter matches, macros and library definitions are
 * expanded, `with { }` is flattened, non-literal bounds are folded to numbers,
 * and comments are gone. Matching the .dsp text instead meant a commented-out
 * slider counted as a declaration — passing the check on exactly the dead knob
 * it exists to catch — while three ordinary Faust idioms were rejected.
 * gen-faust --check already keeps this file in step with the .dsp. */
function validateFaustSliders(
  params: Param[],
  dsp: string,
  faustC: string,
  errors: string[]
): void {
  /* Exemptions stay in the .dsp: they are the author's declaration of intent,
   * and they are comments by design. */
  const adapterControls = declaredExemptions(dsp, "adapter-controls");
  const adapterParams = declaredExemptions(dsp, "adapter-params");
  const paramByKey = new Map(params.map((p) => [p.key, p]));

  /* null args = a checkbox/button, which carries no init/min/max/step. */
  const controls = new Map<string, number[] | null>();
  for (const [, label, argText] of faustC.matchAll(FAUST_UI_RE)) {
    controls.set(
      label,
      argText.split(",").map((arg) => Number(arg.replace(/\(FAUSTFLOAT\)/g, "").trim().replace(/f$/, "")))
    );
  }
  for (const [, label] of faustC.matchAll(FAUST_UI_TOGGLE_RE)) {
    if (!controls.has(label)) controls.set(label, null);
  }

  for (const [label, args] of controls) {
    const param = paramByKey.get(label);
    if (!param) {
      /* An internal control slider is conventionally prefixed with "_". */
      if (label.startsWith("_") || adapterControls.has(label)) continue;
      errors.push(
        `${label ? `the .dsp registers a control labelled "${label}"` : `the .dsp registers an unlabelled control`} ` +
          `which is not a param in module.json — if the C adapter drives it, declare it with ` +
          `\`// moveforge-adapter-controls: ${label}\`; otherwise it is a typo and the knob is dead`
      );
      continue;
    }
    if (args === null) continue;
    /* init, min, max, step — module.json is the single source of truth, so a
     * mismatch means the two disagree about the same control. Compared with a
     * float32 tolerance: these literals have been through the compiler as
     * floats, so 0.1 can come back as 0.100000001. */
    const [init, min, max, step] = args;
    for (const [name, dspValue, jsonValue] of [
      ["default", init, param.default],
      ["min", min, param.min],
      ["max", max, param.max],
      ["step", step, param.step]
    ] as Array<[string, number | undefined, number | undefined]>) {
      if (dspValue === undefined || jsonValue === undefined) continue;
      if (!Number.isFinite(dspValue)) continue;
      if (Math.abs(dspValue - jsonValue) > 1e-6 * Math.max(1, Math.abs(jsonValue))) {
        errors.push(
          `.dsp control "${label}" ${name} ${dspValue} does not match module.json ${name} ${jsonValue}`
        );
      }
    }
  }

  for (const param of params) {
    if (controls.has(param.key) || adapterParams.has(param.key)) continue;
    errors.push(
      `param ${param.key} has no matching hslider("${param.key}", …) in the .dsp, so its zone is ` +
        `never captured and the knob does nothing — if the adapter computes it, declare it with ` +
        `\`// moveforge-adapter-params: ${param.key}\``
    );
  }
}

/* Whether zones[] is sized correctly is now asserted by the compiler: the
 * generated .inc carries a _Static_assert comparing sizeof(core.zones) against
 * <UPPER>_PARAM_COUNT (scripts/gen-params.ts, renderZonesAssert). That covers
 * every accidental form — a literal size, a stale count, a renamed member — in
 * the one place that can see the real layout.
 *
 * The one thing it cannot see is the count being redefined out from under it,
 * since the assert would then compare a poisoned macro against an array sized
 * from the same poisoned macro, and every test that loops to the count would
 * agree with both. That is a policy about the text of the header, so a text
 * check is the honest tool for it. */
function validateParamCountNotRedefined(moduleId: string, header: string, errors: string[]): void {
  const upper = moduleId.toUpperCase();
  if (new RegExp(`^\\s*#\\s*(?:define|undef)\\s+${upper}_PARAM_COUNT\\b`, "m").test(header)) {
    errors.push(
      `${moduleId}_core.h defines or undefines ${upper}_PARAM_COUNT — it must come only from the ` +
        `generated ${moduleId}_params.gen.h, or anything sized or bounded by it silently ` +
        `disagrees with module.json`
    );
  }
}

/* Shipping presets.json and generating the helper is not enough — the wrapper
 * has to reach it, or the chain UI's preset-browse screen lists every preset by
 * name and selecting one does nothing. Four of seven wrappers were in that
 * state (plan 7.1).
 *
 * "Selecting a preset changes a param" is behavioural, so it is asserted by
 * tests/test_<id>_plugin.c against the real plugin ABI, not by searching the
 * wrapper for an include and a couple of string literals — that search passed
 * a wrapper whose set_param("preset") branch had been deleted outright, which
 * is the defect itself. What is left here is the policy that makes the
 * behavioural test exist in the first place, and file existence is a question
 * text matching genuinely answers. */
async function validatePresetsAreExposed(
  moduleId: string,
  presetsJson: PresetsJson,
  errors: string[]
): Promise<void> {
  if (!presetsJson.presets?.length) return;
  const paths = modulePaths(moduleId);
  if (!(await fileExists(paths.testPluginC))) {
    errors.push(
      `${moduleId} ships ${presetsJson.presets.length} preset(s) but has no ${paths.testPluginC} — ` +
        `presets are only reachable on device through the wrapper's set_param("preset"), and a ` +
        `plugin-level test is the only thing here that exercises it`
    );
  }
}

function validateCoreStruct(moduleId: string, params: Param[], header: string, errors: string[]): void {
  for (const p of params) {
    const fieldPattern = new RegExp(`\\bfloat\\s+${p.key}\\b`);
    if (!fieldPattern.test(header)) {
      errors.push(`${moduleId}_core_t is missing field "float ${p.key};" (required by generated set/get)`);
    }
  }
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
