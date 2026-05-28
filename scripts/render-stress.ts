import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { modulePaths, selectedModuleId } from "./lib/modules.ts";

type Param = {
  key: string;
  name: string;
  type: string;
  min: number;
  max: number;
  default: number;
};

type ModuleJson = {
  capabilities?: {
    component_type?: string;
    ui_hierarchy?: {
      levels?: {
        root?: {
          params?: Param[];
        };
      };
    };
  };
};

type StressCase = {
  file: string;
  label: string;
  expect_silence?: boolean;
  params: Record<string, number>;
};

type StressManifest = {
  module_id: string;
  component_type: string;
  cases: StressCase[];
};

const moduleId = selectedModuleId();
const paths = modulePaths(moduleId);
const moduleJson = JSON.parse(await readFile(paths.moduleJson, "utf8")) as ModuleJson;
const componentType = moduleJson.capabilities?.component_type ?? "";
const params = moduleJson.capabilities?.ui_hierarchy?.levels?.root?.params ?? [];

if (componentType !== "sound_generator" && componentType !== "audio_fx") {
  console.log(`[${moduleId}] skipping stress render: component_type='${componentType}'`);
  process.exit(0);
}

const renderBin = process.env.RENDER_BIN ||
  (componentType === "audio_fx" ? `./build/render_fx_${moduleId}` : `./build/render_wav_${moduleId}`);
const stressDir = paths.stressDir;
await mkdir(stressDir, { recursive: true });

const defaults = Object.fromEntries(params.map((param) => [param.key, param.default]));
const cases = buildCases(params, defaults, componentType);

for (const stressCase of cases) {
  const outPath = join(stressDir, stressCase.file);
  const args = componentType === "audio_fx"
    ? [outPath, "--signal", stressCase.file.includes("impulse") ? "impulse" : "sweep", "--seconds", "4"]
    : ["--render", outPath, "5", "36", "18", "127", "36,43,48,55,60"];

  for (const [key, value] of Object.entries(stressCase.params)) {
    args.push(`${key}=${value}`);
  }

  const result = spawnSync(renderBin, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const manifest: StressManifest = {
  module_id: moduleId,
  component_type: componentType,
  cases
};
await writeFile(join(stressDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`[${moduleId}] wrote ${cases.length} stress render(s) to ${stressDir}`);

function buildCases(params: Param[], defaults: Record<string, number>, kind: string): StressCase[] {
  const cases: StressCase[] = [];
  const add = (label: string, values: Record<string, number>, expectSilence = false) => {
    cases.push({
      file: `${String(cases.length).padStart(2, "0")}-${slug(label)}.wav`,
      label,
      expect_silence: expectSilence || undefined,
      params: values
    });
  };

  add("Default", { ...defaults });

  for (const param of params) {
    if (param.min !== param.default) {
      add(`${param.name} Min`, { ...defaults, [param.key]: param.min }, isSilencingParam(param.key, param.min, kind));
    }
    if (param.max !== param.default) {
      add(`${param.name} Max`, { ...defaults, [param.key]: param.max });
    }
  }

  const allMax = Object.fromEntries(params.map((param) => [param.key, param.max]));
  add("All Max", allMax);

  const hot = { ...defaults };
  for (const param of params) {
    if (/(volume|level|mix|drive|fold|fm|cutoff|resonance|reso|feedback|chaos|strike)/i.test(param.key)) {
      hot[param.key] = param.max;
    }
    if (/(attack|decay|release|time)/i.test(param.key)) {
      hot[param.key] = param.min;
    }
  }
  add("Hot Fast", hot);

  if (kind === "audio_fx") {
    add("Impulse Hot", hot);
  }

  return cases;
}

function isSilencingParam(key: string, value: number, kind: string): boolean {
  if (value !== 0) return false;
  if (kind === "sound_generator") return /^(volume|level)$/i.test(key);
  return /^level$/i.test(key);
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
