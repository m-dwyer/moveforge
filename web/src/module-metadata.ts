export type ModuleIndexItem = {
  id: string;
  kind?: string;
  name?: string;
};

export type ModuleIndex = {
  modules?: ModuleIndexItem[];
};

export type ParamDefinition = {
  default: number;
  id: number;
  key: string;
  label: string;
  max: number;
  min: number;
  step?: number;
  type?: string;
  value: number;
};

export type ParamsManifest = {
  module_id: string;
  params?: Array<Omit<ParamDefinition, "value">>;
};

export type ModuleMetadataJson = {
  id: string;
  name?: string;
};

export type Preset = {
  name: string;
  params?: Record<string, number>;
  render?: unknown;
};

export type PresetsJson = {
  presets?: Preset[];
};

export type LoadedModuleMetadata = {
  manifest: ParamsManifest;
  moduleJson: ModuleMetadataJson;
  paramIds: Record<string, number>;
  params: ParamDefinition[];
  presetJson: PresetsJson;
  presets: Preset[];
};

export async function loadModuleMetadata(moduleId: string): Promise<LoadedModuleMetadata> {
  const [manifest, moduleJson, presetJson] = await Promise.all([
    loadJson<ParamsManifest>(`../src/modules/${moduleId}/params.json`),
    loadJson<ModuleMetadataJson>(`../src/modules/${moduleId}/module.json`),
    loadJson<PresetsJson>(`../src/modules/${moduleId}/presets.json`)
  ]);
  const params = paramsFromManifest(manifest);
  return {
    manifest,
    moduleJson,
    paramIds: Object.fromEntries(params.map((param) => [param.key, param.id])),
    params,
    presetJson,
    presets: presetJson.presets ?? []
  };
}

export async function loadModuleIndex(): Promise<ModuleIndex> {
  return loadJson<ModuleIndex>("../src/modules/index.json");
}

async function loadJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json() as Promise<T>;
}

function paramsFromManifest(manifest: ParamsManifest): ParamDefinition[] {
  return (manifest.params ?? []).map((item) => ({ ...item, value: item.default }));
}
