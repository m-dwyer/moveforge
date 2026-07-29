import { flattenParams, paramGroups, type UiHierarchy } from "../../shared/ui-hierarchy.ts";

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
  /* The `ui_hierarchy` level that declared this parameter, and that level's
   * display name. Presentation only — `id` and `key` are the ABI. */
  group?: string;
  groupLabel?: string;
  id: number;
  key: string;
  label: string;
  max: number;
  min: number;
  description?: string;
  randomize?: RandomizeHint;
  step?: number;
  type?: string;
  value: number;
};

export type RandomizeHint = {
  amount?: number;
  max?: number;
  min?: number;
  mode?: "around_default" | "bounded" | "full";
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
    ui_hierarchy?: UiHierarchy<RawParam>;
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

export type MetadataJson = {
  params?: Record<string, string>;
  randomize?: Record<string, RandomizeHint>;
};

export type LoadedModuleMetadata = {
  moduleJson: ModuleMetadataJson;
  paramIds: Record<string, number>;
  params: ParamDefinition[];
  presetJson: PresetsJson;
  presets: Preset[];
};

export async function loadModuleMetadata(moduleId: string): Promise<LoadedModuleMetadata> {
  const [moduleJson, presetJson, metadataJson] = await Promise.all([
    loadJson<ModuleMetadataJson>(`${import.meta.env.BASE_URL}modules/${moduleId}/module.json`),
    loadJson<PresetsJson>(`${import.meta.env.BASE_URL}modules/${moduleId}/presets.json`),
    loadOptionalJson<MetadataJson>(`${import.meta.env.BASE_URL}modules/${moduleId}/metadata.json`)
  ]);
  const params = paramsFromModuleJson(moduleJson, metadataJson?.params ?? {}, metadataJson?.randomize ?? {});
  return {
    moduleJson,
    paramIds: Object.fromEntries(params.map((param) => [param.key, param.id])),
    params,
    presetJson,
    presets: presetJson.presets ?? []
  };
}

export async function loadModuleIndex(): Promise<ModuleIndex> {
  const index = await loadJson<ModuleIndex>(`${import.meta.env.BASE_URL}modules/index.json`);
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

async function loadOptionalJson<T>(path: string): Promise<T | null> {
  const response = await fetch(path, { cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json() as Promise<T>;
}

async function hasWasmBuild(moduleId: string): Promise<boolean> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}wasm/${moduleId}.wasm`, { cache: "no-store" });
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

function paramsFromModuleJson(
  moduleJson: ModuleMetadataJson,
  descriptions: Record<string, string>,
  randomizeHints: Record<string, RandomizeHint>
): ParamDefinition[] {
  /* `index` becomes the id the worklet is addressed by, so this has to be the
   * same order the generated <MODULE>_PARAM_* enum counts in — which is why the
   * flatten is shared with the generators rather than repeated here.
   *
   * Walking the groups instead of the flat list is safe *because* flattenParams is
   * itself defined as paramGroups().flatMap: the running index below counts in
   * exactly the order flattenParams would produce. Recovering the grouping by any
   * other route — re-reading `levels`, matching on key prefixes — would be a second
   * walk that can disagree, which is the failure shared/ui-hierarchy.ts exists to
   * prevent. */
  const raw: Array<RawParam & { group: string; groupLabel?: string }> = [];
  for (const g of paramGroups<RawParam>(moduleJson.capabilities?.ui_hierarchy)) {
    for (const item of g.params) raw.push({ ...item, group: g.group, groupLabel: g.label });
  }
  /* Cheap, and it is the one thing that must not drift: `id` is the index the
   * worklet addresses, so a group walk that disagreed with the flat walk would
   * silently point every knob at the wrong parameter. */
  const flat = flattenParams<RawParam>(moduleJson.capabilities?.ui_hierarchy);
  if (flat.length !== raw.length || flat.some((item, i) => item.key !== raw[i].key)) {
    throw new Error(`${moduleJson.id}: grouped parameter order disagrees with flattenParams`);
  }
  return raw.map((item, index) => ({
    default: item.default,
    group: item.group,
    groupLabel: item.groupLabel,
    id: index,
    key: item.key,
    label: item.name ?? item.key,
    max: item.max,
    min: item.min,
    description: descriptions[item.key],
    randomize: randomizeHints[item.key],
    step: item.step,
    type: item.type,
    value: item.default
  }));
}
