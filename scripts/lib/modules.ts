import { readFile, readdir, stat } from "node:fs/promises";

import {
  type MetadataJson,
  type ModuleJson,
  parseMetadataJson,
  parseModuleJson,
  parsePresetsJson,
  type PresetsJson
} from "../../shared/module-schema.ts";

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
  paramsGenH: string;
  paramsGenInc: string;
  presetsGenInc: string;
  scopeGenInc: string;
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
  deviceComponentDir: string | null;
  dspAuthoring: DspAuthoring;
  id: string;
  paths: ModulePaths;
  renderBin: string;
  renderDemoOut: string;
  renderKind: RenderKind | null;
  supportsStress: boolean;
  wasmGlue: string | null;
};

/**
 * Read and validate a module's JSON. These are the only places the tooling
 * turns those files into values, so a malformed one fails here with a path and
 * a message rather than as a TypeError inside whichever generator reached the
 * missing field first.
 *
 * presets.json and metadata.json are optional — a module with neither is valid,
 * and every caller already treated a missing file as empty.
 */
export async function readModuleJson(moduleId: string): Promise<ModuleJson> {
  const path = modulePaths(moduleId).moduleJson;
  return parseModuleJson(JSON.parse(await readFile(path, "utf8")), path);
}

export async function readPresetsJson(moduleId: string): Promise<PresetsJson> {
  const path = modulePaths(moduleId).presets;
  const raw = await readFile(path, "utf8").catch(() => '{"presets":[]}');
  return parsePresetsJson(JSON.parse(raw), path);
}

export async function readMetadataJson(moduleId: string): Promise<MetadataJson> {
  const path = `${modulePaths(moduleId).moduleDir}/metadata.json`;
  const raw = await readFile(path, "utf8").catch(() => "{}");
  return parseMetadataJson(JSON.parse(raw), path);
}

export async function selectedModuleIds(): Promise<string[]> {
  return process.env.MODULE_ID ? [process.env.MODULE_ID] : listModuleIds();
}

export async function selectedModuleTargets(): Promise<ModuleBuildTarget[]> {
  return Promise.all((await selectedModuleIds()).map((moduleId) => readModuleTarget(moduleId)));
}

/**
 * Every module, ignoring MODULE_ID.
 *
 * The generated ninja files use this rather than the selection: a build file
 * describes the whole graph, and MODULE_ID picks which of its targets to build.
 * Generating a partial build file instead would mean `MODULE_ID=x mise run
 * wasm-build` left behind a build/wasm.ninja that knows about one module, so a
 * later bare `ninja -f build/wasm.ninja` would silently build only that one.
 */
export async function allModuleTargets(): Promise<ModuleBuildTarget[]> {
  return Promise.all((await listModuleIds()).map((moduleId) => readModuleTarget(moduleId)));
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
    paramsGenH: `${moduleDir}/dsp/${moduleId}_params.gen.h`,
    paramsGenInc: `${moduleDir}/dsp/${moduleId}_params.gen.inc`,
    presetsGenInc: `${moduleDir}/dsp/${moduleId}_presets.gen.inc`,
    scopeGenInc: `${moduleDir}/dsp/${moduleId}_scope.gen.inc`,
    presets: `${moduleDir}/presets.json`,
    stressDir: `renders/${moduleId}-stress`,
    suiteDir: `renders/${moduleId}-suite`,
    testCoreC: `tests/test_${moduleId}_core.c`,
    testPluginC: `tests/test_${moduleId}_plugin.c`,
    wrapperC: `${moduleDir}/dsp/${moduleId}.c`
  };
}

export async function readModuleTarget(moduleId: string): Promise<ModuleBuildTarget> {
  const paths = modulePaths(moduleId);
  const moduleJson = await readModuleJson(moduleId);
  const componentType = moduleJson.capabilities.component_type;
  const dspAuthoring: DspAuthoring = await fileExists(paths.faustDsp) ? "faust" : "c";
  const coreImpl = dspAuthoring === "faust" ? paths.adapterC : paths.coreC;
  const renderKind = renderKindFor(componentType);

  return {
    componentType,
    coreImpl,
    deviceComponentDir: deviceComponentDirFor(componentType),
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

function deviceComponentDirFor(componentType: string): string | null {
  if (componentType === "sound_generator") return "sound_generators";
  if (componentType === "audio_fx") return "audio_fx";
  if (componentType === "midi_fx") return "midi_fx";
  return null;
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
