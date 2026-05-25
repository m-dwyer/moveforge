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

type RawParam = {
  default: number;
  key: string;
  max: number;
  min: number;
  name?: string;
  step?: number;
  type?: string;
};

export type ModuleMetadataJson = {
  capabilities?: {
    component_type?: string;
    ui_hierarchy?: {
      levels?: {
        root?: {
          knobs?: string[];
          name?: string;
          params?: RawParam[];
        };
      };
    };
  };
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
  moduleJson: ModuleMetadataJson;
  paramIds: Record<string, number>;
  params: ParamDefinition[];
  presetJson: PresetsJson;
  presets: Preset[];
};

export async function loadModuleMetadata(moduleId: string): Promise<LoadedModuleMetadata> {
  const [moduleJson, presetJson] = await Promise.all([
    loadJson<ModuleMetadataJson>(`/src/modules/${moduleId}/module.json`),
    loadJson<PresetsJson>(`/src/modules/${moduleId}/presets.json`)
  ]);
  const params = paramsFromModuleJson(moduleJson);
  return {
    moduleJson,
    paramIds: Object.fromEntries(params.map((param) => [param.key, param.id])),
    params,
    presetJson,
    presets: presetJson.presets ?? []
  };
}

export async function loadModuleIndex(): Promise<ModuleIndex> {
  return loadJson<ModuleIndex>("/src/modules/index.json");
}

async function loadJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json() as Promise<T>;
}

function paramsFromModuleJson(moduleJson: ModuleMetadataJson): ParamDefinition[] {
  const raw = moduleJson.capabilities?.ui_hierarchy?.levels?.root?.params ?? [];
  return raw.map((item, index) => ({
    default: item.default,
    id: index,
    key: item.key,
    label: item.name ?? item.key,
    max: item.max,
    min: item.min,
    step: item.step,
    type: item.type,
    value: item.default
  }));
}
