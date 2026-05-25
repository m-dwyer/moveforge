import { readFile } from "node:fs/promises";
import { modulePaths, selectedModuleIds } from "./lib/modules.ts";

type Param = {
  default: number;
  id: number;
  key: string;
  label: string;
  max: number;
  min: number;
  step: number;
  type: string;
};

type ParamsManifest = {
  module_id: string;
  params: Param[];
};

type ModuleJson = {
  capabilities?: {
    ui_hierarchy?: {
      levels?: {
        root?: {
          knobs?: string[];
          params?: Param[];
        };
      };
    };
  };
  id: string;
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

const moduleIds = await selectedModuleIds();

const allErrors: ValidationGroup[] = [];
await validateIndex(moduleIds);

for (const moduleId of moduleIds) {
  const errors: string[] = [];
  await validateModule(moduleId, errors);
  if (errors.length) {
    allErrors.push({ moduleId, errors });
  }
}

if (allErrors.length) {
  console.error("Parameter validation failed:");
  for (const { moduleId, errors } of allErrors) {
    console.error(`\n${moduleId}:`);
    for (const error of errors) console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Validated parameter metadata for ${moduleIds.length} module(s): ${moduleIds.join(", ")}`);

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
  const [manifest, moduleJson, presetsJson, header, core] = await Promise.all([
    readJson<ParamsManifest>(paths.manifest),
    readJson<ModuleJson>(paths.moduleJson),
    readJson<PresetsJson>(paths.presets),
    readFile(paths.coreHeader, "utf8"),
    readFile(paths.coreC, "utf8")
  ]);

  const params = manifest.params || [];
  const manifestKeys = params.map((p) => p.key);

  if (manifest.module_id !== moduleJson.id) {
    errors.push(`params.json module_id ${manifest.module_id} does not match module.json id ${moduleJson.id}`);
  }
  if (moduleJson.id !== moduleId) {
    errors.push(`module.json id ${moduleJson.id} does not match directory ${moduleId}`);
  }

  const ids = params.map((p) => p.id);
  for (let i = 0; i < ids.length; i++) {
    if (ids[i] !== i) errors.push(`param ${params[i]?.key || i} has id ${ids[i]}, expected ${i}`);
  }
  if (new Set(manifestKeys).size !== manifestKeys.length) errors.push("duplicate param keys in manifest");

  const moduleParams = moduleJson?.capabilities?.ui_hierarchy?.levels?.root?.params || [];
  compareParamLists(params, moduleParams, "module.json root params", errors);

  const knobs = moduleJson?.capabilities?.ui_hierarchy?.levels?.root?.knobs || [];
  for (const key of knobs) {
    if (!manifestKeys.includes(key)) errors.push(`module.json knob ${key} is not a manifest param`);
  }

  for (const preset of presetsJson.presets || []) {
    const presetKeys = Object.keys(preset.params || {});
    for (const key of presetKeys) {
      if (!manifestKeys.includes(key)) errors.push(`preset ${preset.name} uses unknown param ${key}`);
    }
    for (const param of params) {
      if (!(param.key in (preset.params || {}))) errors.push(`preset ${preset.name} is missing param ${param.key}`);
      const value = preset.params?.[param.key];
      if (typeof value === "number" && (value < param.min || value > param.max)) {
        errors.push(`preset ${preset.name} param ${param.key}=${value} outside [${param.min}, ${param.max}]`);
      }
    }
  }

  const enumPrefix = `${moduleId.toUpperCase()}_PARAM_`;
  for (const param of params) {
    const enumName = `${enumPrefix}${param.key.toUpperCase()}`;
    const enumPattern = new RegExp(`${enumName}\\s*=\\s*${param.id}\\b`);
    if (!enumPattern.test(header)) errors.push(`missing or wrong enum mapping ${enumName} = ${param.id}`);
    if (!core.includes(`strcmp(key, "${param.key}") == 0`)) errors.push(`${moduleId}_param_id missing key ${param.key}`);
    if (!core.includes(enumName)) errors.push(`core set/get missing enum for ${param.key}`);
  }
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8"));
}

function compareParamLists(expected: Param[], actual: Param[], label: string, errors: string[]): void {
  if (actual.length !== expected.length) {
    errors.push(`${label} has ${actual.length} params, expected ${expected.length}`);
  }
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i];
    const a = actual[i];
    if (!a) continue;
    const fields: Array<keyof Param> = ["id", "key", "label", "type", "min", "max", "default", "step"];
    for (const field of fields) {
      if (a[field] !== e[field]) {
        errors.push(`${label}[${i}].${field} is ${JSON.stringify(a[field])}, expected ${JSON.stringify(e[field])}`);
      }
    }
  }
}
