import { readFile } from "node:fs/promises";

const [manifest, moduleJson, presetsJson, header, core, worklet] = await Promise.all([
  readJson("src/params.json"),
  readJson("src/module.json"),
  readJson("src/presets.json"),
  readFile("src/dsp/westfold_core.h", "utf8"),
  readFile("src/dsp/westfold_core.c", "utf8"),
  readFile("web/westfold-worklet.js", "utf8")
]);

const errors = [];
const params = manifest.params || [];
const manifestKeys = params.map((p) => p.key);

if (manifest.module_id !== moduleJson.id) {
  errors.push(`params.json module_id ${manifest.module_id} does not match module.json id ${moduleJson.id}`);
}

const ids = params.map((p) => p.id);
for (let i = 0; i < ids.length; i++) {
  if (ids[i] !== i) errors.push(`param ${params[i]?.key || i} has id ${ids[i]}, expected ${i}`);
}
if (new Set(manifestKeys).size !== manifestKeys.length) errors.push("duplicate param keys in manifest");

const moduleParams = moduleJson?.capabilities?.ui_hierarchy?.levels?.root?.params || [];
compareParamLists(params, moduleParams, "module.json root params");

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

for (const param of params) {
  const enumName = `WESTFOLD_PARAM_${param.key.toUpperCase()}`;
  const enumPattern = new RegExp(`${enumName}\\s*=\\s*${param.id}\\b`);
  if (!enumPattern.test(header)) errors.push(`missing or wrong enum mapping ${enumName} = ${param.id}`);
  if (!core.includes(`strcmp(key, "${param.key}") == 0`)) errors.push(`westfold_param_id missing key ${param.key}`);
  if (!core.includes(`WESTFOLD_PARAM_${param.key.toUpperCase()}`)) errors.push(`core set/get missing enum for ${param.key}`);
  if (!worklet.includes(`${param.key}: ${param.id}`)) errors.push(`worklet fallback PARAM_IDS missing ${param.key}: ${param.id}`);
}

if (errors.length) {
  console.error("Parameter validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Validated ${params.length} params for module ${manifest.module_id}`);

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function compareParamLists(expected, actual, label) {
  if (actual.length !== expected.length) {
    errors.push(`${label} has ${actual.length} params, expected ${expected.length}`);
  }
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i];
    const a = actual[i];
    if (!a) continue;
    for (const field of ["id", "key", "label", "type", "min", "max", "default", "step"]) {
      if (a[field] !== e[field]) {
        errors.push(`${label}[${i}].${field} is ${JSON.stringify(a[field])}, expected ${JSON.stringify(e[field])}`);
      }
    }
  }
}
