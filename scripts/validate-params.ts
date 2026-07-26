import { readFile, stat } from "node:fs/promises";
import { modulePaths, selectedModuleIds } from "./lib/modules.ts";

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
/* Faust UI primitives that carry a label plus (init, min, max, step). */
const FAUST_SLIDER_RE = /\b(?:hslider|vslider|nentry)\s*\(\s*"([^"]*)"\s*,([^)]*)\)/g;
/* Schwung chain-host limits — see validateHostLimits for provenance. */
const HOST_MAX_KEY_CHARS = 31;
const HOST_MAX_NAME_CHARS = 31;
const HOST_MAX_PARAMS = 256;
const HOST_MAX_MODULE_JSON_BYTES = 65536;

const moduleIds = await selectedModuleIds();
const allErrors: ValidationGroup[] = [];

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
    await validateGenInc(moduleId, errors);
    validatePresets(presetsJson, params, errors);
    await validatePresetsAreExposed(moduleId, presetsJson, errors);
    validateMetadata(moduleId, metadataJson, params, errors);
    const coreHeader = await readFile(paths.coreHeader, "utf8");
    validateCoreStruct(moduleId, params, coreHeader, errors);
    validateZoneSizing(moduleId, coreHeader, errors);
    if (await fileExists(paths.faustDsp)) {
      validateFaustSliders(params, await readFile(paths.faustDsp, "utf8"), errors);
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
 *   chain_params.c:645,660  key and name are both truncated at 31 chars —
 *     note name is clamped to 31 even though chain_param_info_t.name is
 *     char[64], so the field size is misleading
 *   chain_params.c:561,774  module.json is rejected at >= 65536 bytes
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

  const levels = moduleJson.capabilities?.ui_hierarchy?.levels ?? {};
  const seen = new Map<string, string>();
  let total = 0;

  for (const [levelName, level] of Object.entries(levels)) {
    for (const param of level?.params ?? []) {
      total++;
      if (typeof param.key === "string") {
        if (param.key.length > HOST_MAX_KEY_CHARS) {
          errors.push(
            `param ${param.key}: key is ${param.key.length} chars — the host truncates keys at ` +
              `${HOST_MAX_KEY_CHARS}, so it would look up a key this module does not answer to`
          );
        }
        /* The host dedupes across every level, not per level. */
        const previous = seen.get(param.key);
        if (previous !== undefined) {
          errors.push(
            `param key "${param.key}" appears in both levels.${previous} and levels.${levelName} — ` +
              `a duplicate key anywhere in ui_hierarchy makes the host reject the entire module`
          );
        } else {
          seen.set(param.key, levelName);
        }
      }
      if (typeof param.name === "string" && param.name.length > HOST_MAX_NAME_CHARS) {
        errors.push(
          `param ${param.key}: name "${param.name}" is ${param.name.length} chars — the host ` +
            `truncates display names at ${HOST_MAX_NAME_CHARS}`
        );
      }
    }
  }

  if (total > HOST_MAX_PARAMS) {
    errors.push(
      `${total} params across all ui_hierarchy levels exceeds the host's ` +
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

async function validateGenInc(moduleId: string, errors: string[]): Promise<void> {
  const paths = modulePaths(moduleId);
  const existing = await readFile(paths.paramsGenInc, "utf8").catch(() => "");
  if (!existing) {
    errors.push(`${paths.paramsGenInc} is missing — run \`mise run gen-params\``);
    return;
  }
  const moduleJson = await readJson<ModuleJson>(paths.moduleJson);
  const params = moduleJson.capabilities?.ui_hierarchy?.levels?.root?.params || [];
  for (const p of params) {
    if (!existing.includes(`return ${moduleId.toUpperCase()}_PARAM_${p.key.toUpperCase()}`)) {
      errors.push(`${paths.paramsGenInc} appears stale for param ${p.key} — run \`mise run gen-params\``);
      return;
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

/* The adapter captures a Faust zone by matching the slider's label against
 * <id>_param_id(). A label that does not match any module.json key returns -1,
 * so the zone is never captured and push_params_to_faust skips it forever: a
 * knob that compiles, validates, renders and ships while doing nothing. The
 * only way to catch it is to compare the two lists directly. */
function validateFaustSliders(params: Param[], dsp: string, errors: string[]): void {
  const adapterControls = declaredExemptions(dsp, "adapter-controls");
  const adapterParams = declaredExemptions(dsp, "adapter-params");
  const paramByKey = new Map(params.map((p) => [p.key, p]));

  const sliders = new Map<string, string[]>();
  for (const [, label, argText] of dsp.matchAll(FAUST_SLIDER_RE)) {
    sliders.set(label, argText.split(",").map((s) => s.trim()));
  }

  for (const [label, args] of sliders) {
    const param = paramByKey.get(label);
    if (!param) {
      /* An internal control slider is conventionally prefixed with "_". */
      if (label.startsWith("_") || adapterControls.has(label)) continue;
      errors.push(
        `${label ? `.dsp declares hslider("${label}", …)` : `.dsp declares an unlabelled slider`} ` +
          `which is not a param in module.json — if the C adapter drives it, declare it with ` +
          `\`// moveforge-adapter-controls: ${label}\`; otherwise it is a typo and the knob is dead`
      );
      continue;
    }
    /* init, min, max, step — module.json is the single source of truth, so a
     * mismatch means the two disagree about the same control. */
    const [init, min, max, step] = args;
    for (const [name, dspValue, jsonValue] of [
      ["default", init, param.default],
      ["min", min, param.min],
      ["max", max, param.max],
      ["step", step, param.step]
    ] as Array<[string, string | undefined, number | undefined]>) {
      if (dspValue === undefined || jsonValue === undefined) continue;
      const parsed = Number(dspValue);
      if (!Number.isFinite(parsed)) continue; // e.g. "MAXDELAY - 8"
      if (parsed !== jsonValue) {
        errors.push(
          `.dsp hslider("${label}") ${name} ${parsed} does not match module.json ${name} ${jsonValue}`
        );
      }
    }
  }

  for (const param of params) {
    if (sliders.has(param.key) || adapterParams.has(param.key)) continue;
    errors.push(
      `param ${param.key} has no matching hslider("${param.key}", …) in the .dsp, so its zone is ` +
        `never captured and the knob does nothing — if the adapter computes it, declare it with ` +
        `\`// moveforge-adapter-params: ${param.key}\``
    );
  }
}

/* A Faust adapter captures one zone pointer per param into a fixed array
 * indexed by param id. Sized with a literal, adding a param to module.json
 * makes capture_slider write one past the end — into whatever field follows it
 * in the struct. There is no redzone between struct fields, so ASan cannot see
 * it, the compiler cannot warn, and nothing else in the pipeline notices.
 * Requiring the generated count makes the array grow with module.json. */
function validateZoneSizing(moduleId: string, header: string, errors: string[]): void {
  const upper = moduleId.toUpperCase();
  for (const [, size] of header.matchAll(/\bzones\s*\[\s*([^\]]+?)\s*\]/g)) {
    if (size !== `${upper}_PARAM_COUNT`) {
      errors.push(
        `${moduleId}_core_t declares zones[${size}] — it must be sized ` +
          `zones[${upper}_PARAM_COUNT] (from ${moduleId}_params.gen.h) so it cannot ` +
          `overflow into the next struct field when a param is added`
      );
    }
  }
}

/* Shipping presets.json and generating the helper is not enough — the wrapper
 * has to include it and answer preset / preset_count / preset_name, or the
 * chain UI's preset-browse screen is dead for that module while everything
 * about the build looks correct. Four of seven wrappers were in exactly that
 * state (plan 7.1). */
async function validatePresetsAreExposed(
  moduleId: string,
  presetsJson: PresetsJson,
  errors: string[]
): Promise<void> {
  if (!presetsJson.presets?.length) return;
  const paths = modulePaths(moduleId);
  const wrapper = await readFile(paths.wrapperC, "utf8").catch(() => "");
  if (!wrapper) return;
  if (!wrapper.includes(`${moduleId}_presets.gen.inc`)) {
    errors.push(
      `${moduleId}.c does not include ${moduleId}_presets.gen.inc, so the ${presetsJson.presets.length} ` +
        `preset(s) in presets.json cannot be reached on device — the chain UI's preset screen is dead`
    );
    return;
  }
  for (const key of ["preset_count", "preset_name"]) {
    if (!wrapper.includes(`"${key}"`)) {
      errors.push(`${moduleId}.c includes the generated presets but never answers get_param("${key}")`);
    }
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
