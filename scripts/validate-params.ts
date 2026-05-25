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

type ValidationGroup = {
  errors: string[];
  moduleId: string;
};

const VALID_COMPONENT_TYPES = new Set([
  "sound_generator",
  "audio_fx",
  "midi_fx",
  "utility",
  "tool",
  "overtake"
]);

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

  if (moduleJson.ui_chain && !(await fileExists(`${paths.moduleDir}/${moduleJson.ui_chain}`))) {
    errors.push(`ui_chain "${moduleJson.ui_chain}" referenced but file missing`);
  }

  const params = caps.ui_hierarchy?.levels?.root?.params;
  if (params) {
    validateParams(moduleId, params, errors);
    validateGenInc(moduleId, errors);
    validatePresets(presetsJson, params, errors);
    validateCoreStruct(moduleId, params, await readFile(paths.coreHeader, "utf8"), errors);
    const knobs = caps.ui_hierarchy?.levels?.root?.knobs || [];
    const paramKeys = new Set(params.map((p) => p.key));
    for (const key of knobs) {
      if (!paramKeys.has(key)) errors.push(`knob ${key} is not a declared param`);
    }
  } else if (caps.component_type === "sound_generator" || caps.component_type === "audio_fx") {
    errors.push(`module.json is missing capabilities.ui_hierarchy.levels.root.params`);
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
    if (!p.type) errors.push(`param ${p.key} missing type`);
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
