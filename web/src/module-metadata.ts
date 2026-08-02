import {
  definitionGroups,
  definitionParams,
  type ModuleDefinition
} from "../../shared/module-definition.ts";

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
  display_format?: string;
  randomize?: RandomizeHint;
  step?: number;
  type?: string;
  unit?: string;
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
  display_format?: string;
  key: string;
  max: number;
  min: number;
  name?: string;
  step?: number;
  type?: string;
  /* Host fields (chain_internal.h:111-112). Carried through so the browser can
   * show what the device shows instead of a bare float. */
  unit?: string;
};

/* The authored definition, which is what the browser reads. It deliberately does
 * not read the emitted module.json: that file is the Schwung target's artifact,
 * and the browser is previewing the module, not the target. Emitter drift is
 * caught by `mise run validate`, not here. */
export type ModuleMetadataJson = ModuleDefinition;

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
    loadJson<ModuleMetadataJson>(`${import.meta.env.BASE_URL}modules/${moduleId}/module.def.json`),
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
  /* `index` becomes the id the worklet is addressed by, so this has to count in
   * the same order the generated <MODULE>_PARAM_* enum does. Both derive from
   * the definition's `groups` array — the browser directly, the C through the
   * emitted ui_hierarchy — which is why definitionGroups is shared rather than
   * repeated here. Recovering the grouping by any other route (re-reading the
   * emitted levels, matching on key prefixes) would be a second walk that can
   * disagree. */
  const raw: Array<RawParam & { group: string; groupLabel?: string }> = [];
  for (const g of definitionGroups(moduleJson)) {
    for (const item of g.params) raw.push({ ...(item as RawParam), group: g.group, groupLabel: g.label });
  }
  /* Cheap, and it is the one thing that must not drift: `id` is the index the
   * worklet addresses, so a group walk that disagreed with the flat walk would
   * silently point every knob at the wrong parameter. */
  const flat = definitionParams(moduleJson);
  if (flat.length !== raw.length || flat.some((item, i) => item.key !== raw[i].key)) {
    throw new Error(`${moduleJson.id}: grouped parameter order disagrees with definitionParams`);
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
    display_format: item.display_format,
    randomize: randomizeHints[item.key],
    step: item.step,
    type: item.type,
    unit: item.unit,
    value: item.default
  }));
}
