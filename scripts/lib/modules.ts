import { readdir } from "node:fs/promises";

export const DEFAULT_MODULE_ID = "westfold";

export type ModulePaths = {
  coreC: string;
  coreHeader: string;
  goldenMetrics: string;
  moduleDir: string;
  moduleJson: string;
  paramsGenInc: string;
  presets: string;
  suiteDir: string;
  wasmC: string;
};

export function selectedModuleId(): string {
  return process.env.MODULE_ID || DEFAULT_MODULE_ID;
}

export async function selectedModuleIds(): Promise<string[]> {
  return process.env.MODULE_ID ? [process.env.MODULE_ID] : listModuleIds();
}

export async function listModuleIds(): Promise<string[]> {
  return (await readdir("src/modules", { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => entry.name)
    .sort();
}

export function modulePaths(moduleId: string): ModulePaths {
  const moduleDir = `src/modules/${moduleId}`;
  return {
    coreC: `${moduleDir}/dsp/${moduleId}_core.c`,
    coreHeader: `${moduleDir}/dsp/${moduleId}_core.h`,
    goldenMetrics: `goldens/${moduleId}/metrics.json`,
    moduleDir,
    moduleJson: `${moduleDir}/module.json`,
    paramsGenInc: `${moduleDir}/dsp/${moduleId}_params.gen.inc`,
    presets: `${moduleDir}/presets.json`,
    suiteDir: `renders/${moduleId}-suite`,
    wasmC: `${moduleDir}/dsp/${moduleId}_wasm.c`
  };
}
