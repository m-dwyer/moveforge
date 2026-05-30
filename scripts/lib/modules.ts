import { readFile, readdir, stat } from "node:fs/promises";

export type ComponentType = "sound_generator" | "audio_fx" | "midi_fx";
export type DspAuthoring = "c" | "faust";
export type RenderKind = ComponentType;

export type ModulePaths = {
  adapterC: string;
  coreC: string;
  coreHeader: string;
  faustC: string;
  faustDsp: string;
  goldenMetrics: string;
  moduleDir: string;
  moduleJson: string;
  paramsGenInc: string;
  presetsGenInc: string;
  presets: string;
  stressDir: string;
  suiteDir: string;
  testCoreC: string;
  testPluginC: string;
  wrapperC: string;
};

export type ModuleBuildTarget = {
  componentType: string;
  coreImpl: string;
  dspAuthoring: DspAuthoring;
  id: string;
  paths: ModulePaths;
  renderBin: string;
  renderDemoOut: string;
  renderKind: RenderKind | null;
  supportsStress: boolean;
  wasmGlue: string | null;
};

type ModuleJson = {
  capabilities?: {
    component_type?: string;
  };
};

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
    adapterC: `${moduleDir}/dsp/${moduleId}_adapter.c`,
    coreC: `${moduleDir}/dsp/${moduleId}_core.c`,
    coreHeader: `${moduleDir}/dsp/${moduleId}_core.h`,
    faustC: `${moduleDir}/dsp/${moduleId}_faust.c`,
    faustDsp: `${moduleDir}/dsp/${moduleId}.dsp`,
    goldenMetrics: `goldens/${moduleId}/metrics.json`,
    moduleDir,
    moduleJson: `${moduleDir}/module.json`,
    paramsGenInc: `${moduleDir}/dsp/${moduleId}_params.gen.inc`,
    presetsGenInc: `${moduleDir}/dsp/${moduleId}_presets.gen.inc`,
    presets: `${moduleDir}/presets.json`,
    stressDir: `renders/${moduleId}-stress`,
    suiteDir: `renders/${moduleId}-suite`,
    testCoreC: `tests/test_${moduleId}_core.c`,
    testPluginC: `tests/test_${moduleId}_plugin.c`,
    wrapperC: `${moduleDir}/dsp/${moduleId}.c`
  };
}

export async function selectedModuleTargets(): Promise<ModuleBuildTarget[]> {
  return Promise.all((await selectedModuleIds()).map((id) => readModuleTarget(id)));
}

export async function readModuleTarget(moduleId: string): Promise<ModuleBuildTarget> {
  const paths = modulePaths(moduleId);
  const moduleJson = JSON.parse(await readFile(paths.moduleJson, "utf8")) as ModuleJson;
  const componentType = moduleJson.capabilities?.component_type ?? "";
  const dspAuthoring: DspAuthoring = await exists(paths.faustDsp) ? "faust" : "c";
  const coreImpl = dspAuthoring === "faust" ? paths.adapterC : paths.coreC;
  const renderKind = renderKindFor(componentType);

  return {
    componentType,
    coreImpl,
    dspAuthoring,
    id: moduleId,
    paths,
    renderBin: renderBinFor(moduleId, renderKind),
    renderDemoOut: renderDemoOutFor(moduleId, renderKind),
    renderKind,
    supportsStress: componentType === "sound_generator" || componentType === "audio_fx",
    wasmGlue: wasmGlueFor(componentType)
  };
}

function renderKindFor(componentType: string): RenderKind | null {
  if (componentType === "sound_generator" || componentType === "audio_fx" || componentType === "midi_fx") {
    return componentType;
  }
  return null;
}

function renderBinFor(moduleId: string, renderKind: RenderKind | null): string {
  if (renderKind === "audio_fx") return `./build/render_fx_${moduleId}`;
  if (renderKind === "midi_fx") return `./build/trace_midi_fx_${moduleId}`;
  return `./build/render_wav_${moduleId}`;
}

function renderDemoOutFor(moduleId: string, renderKind: RenderKind | null): string {
  return renderKind === "midi_fx" ? `renders/${moduleId}-demo.trace` : `renders/${moduleId}-demo.wav`;
}

function wasmGlueFor(componentType: string): string | null {
  if (componentType === "sound_generator") return "src/host/schwung_wasm_glue_sg.c";
  if (componentType === "audio_fx") return "src/host/schwung_wasm_glue_fx.c";
  if (componentType === "midi_fx") return "src/host/midi_fx_wasm_glue.c";
  return null;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
