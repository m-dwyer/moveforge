import { fileURLToPath } from "node:url";
import { densePresetValues } from "../shared/presets.ts";
import { type Preset } from "../shared/module-schema.ts";
import { type SchwungParam } from "../shared/targets/schwung.ts";
import { flattenParams } from "../shared/ui-hierarchy.ts";
import { modulePaths, readModuleJson, readPresetsJson, selectedModuleIds } from "./lib/modules.ts";
import { cFloatLiteral, escapeCString } from "./lib/c.ts";
import { renderGenerated } from "./lib/eta.ts";
import { type GenerateOptions, writeGeneratedFile } from "./lib/generated-files.ts";

/**
 * Generate (or check) each module's <module>_presets.gen.inc from presets.json.
 * Returns the number of modules whose generated output is stale (0 when in sync).
 */
export async function generate(options: GenerateOptions = {}): Promise<number> {
  const mode = options.mode ?? "write";
  const moduleIds = options.moduleIds ?? (await selectedModuleIds());

  let drift = 0;
  for (const moduleId of moduleIds) {
    const paths = modulePaths(moduleId);
    const moduleJson = await readModuleJson(moduleId);
    const params = flattenParams<SchwungParam>(moduleJson.capabilities.ui_hierarchy);
    if (params.length === 0) {
      console.warn(`[${moduleId}] no params in any capabilities.ui_hierarchy level — skipping`);
      continue;
    }

    const presets = (await readPresetsJson(moduleId)).presets ?? [];
    const generated = renderInc(moduleId, params, presets);
    drift += await writeGeneratedFile({
      generated,
      mode,
      moduleId,
      outPath: paths.presetsGenInc,
      staleMessage: "run `mise run gen-presets`",
      writeMessage: `wrote ${paths.presetsGenInc} (${presets.length} preset${presets.length === 1 ? "" : "s"})`
    });
  }

  return drift;
}

/**
 * Resolving a preset stays here rather than in the template: a key the preset
 * omits takes its declared default (shared/presets.ts), which is the same number
 * an explicit copy would have put here — the table is applied wholesale, so
 * sparse and dense spellings must generate identical C. cFloatLiteral then has
 * to emit a literal C reads back as the same float. Both are contracts; the
 * template only lays the results out.
 */
function renderInc(moduleId: string, params: SchwungParam[], presets: Preset[]): string {
  const upper = moduleId.toUpperCase();
  return renderGenerated("presets.gen.inc", {
    coreType: `${moduleId}_core_t`,
    guard: `${upper}_PRESETS_GEN_INC`,
    moduleId,
    paramCount: params.length,
    paramKeys: params.map((p) => escapeCString(p.key)),
    presets: presets.map((preset) => ({
      name: escapeCString(preset.name),
      values: densePresetValues(params, preset.params, `[${moduleId}] preset ${preset.name}`)
        .map((resolved) => cFloatLiteral(resolved.value, "preset value"))
    })),
    upper
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2] === "--check" ? "check" : "write";
  const drift = await generate({ mode });
  if (mode === "check" && drift > 0) process.exit(1);
}
