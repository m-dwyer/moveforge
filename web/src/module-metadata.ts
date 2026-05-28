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
    loadJson<ModuleMetadataJson>(`/modules/${moduleId}/module.json`),
    loadJson<PresetsJson>(`/modules/${moduleId}/presets.json`)
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
  const index = await loadJson<ModuleIndex>("/modules/index.json");
  const modules = index.modules ?? [];
  const availability = await Promise.all(modules.map(async (module) => ({
    module,
    available: await hasWasmBuild(module.id)
  })));
  return {
    ...index,
    modules: availability.filter((item) => item.available).map((item) => item.module)
  };
}

async function loadJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json() as Promise<T>;
}

async function hasWasmBuild(moduleId: string): Promise<boolean> {
  try {
    const response = await fetch(`/wasm/${moduleId}.wasm`, { cache: "no-store" });
    if (!response.ok) return false;
    const bytes = await response.arrayBuffer();
    return looksLikeWasm(bytes);
  } catch {
    return false;
  }
}

function looksLikeWasm(bytes: ArrayBuffer): boolean {
  const header = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 4));
  return header.length === 4 && header[0] === 0x00 && header[1] === 0x61 && header[2] === 0x73 && header[3] === 0x6d;
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
