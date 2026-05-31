import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { modulePaths, selectedModuleIds } from "./lib/modules.ts";
import { cFloatLiteral, escapeCString } from "./lib/c.ts";
import { type GenerateOptions, writeGeneratedFile } from "./lib/generated-files.ts";
import { renderTemplateString } from "./lib/templates.ts";

const TEMPLATE_PATH = "templates/generated/presets.gen.inc.tmpl";

type Param = { key: string };
type ModuleJson = {
  capabilities?: {
    ui_hierarchy?: {
      levels?: {
        root?: {
          params?: Param[];
        };
      };
    };
  };
  id: string;
};
type Preset = {
  name: string;
  params?: Record<string, number>;
};
type PresetsJson = {
  presets?: Preset[];
};

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
    const moduleJson = JSON.parse(await readFile(paths.moduleJson, "utf8")) as ModuleJson;
    const params = moduleJson.capabilities?.ui_hierarchy?.levels?.root?.params;
    if (!params) {
      console.warn(`[${moduleId}] no capabilities.ui_hierarchy.levels.root.params — skipping`);
      continue;
    }

    const presetsJson = JSON.parse(
      await readFile(paths.presets, "utf8").catch(() => '{"presets":[]}')
    ) as PresetsJson;
    const presets = presetsJson.presets ?? [];
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

function renderInc(moduleId: string, params: Param[], presets: Preset[]): string {
  const upper = moduleId.toUpperCase();
  const guard = `${upper}_PRESETS_GEN_INC`;
  const coreT = `${moduleId}_core_t`;
  const paramKeys = params.map((p) => `    "${escapeCString(p.key)}"`).join(",\n");
  const presetValues = presets
    .map((preset, index) => {
      const values = params.map((p) => {
        const value = preset.params?.[p.key];
        if (typeof value !== "number") {
          throw new Error(`[${moduleId}] preset ${preset.name} missing numeric param ${p.key}`);
        }
        return cf(value, "preset value");
      });
      return `static const float ${moduleId}_preset_values_${index}[${params.length}] = { ${values.join(", ")} };`;
    })
    .join("\n");
  const presetTable = presets
    .map((preset, index) => `    { "${escapeCString(preset.name)}", ${moduleId}_preset_values_${index} }`)
    .join(",\n");

  return renderTemplateString(readTemplate(), {
    coreType: coreT,
    guard,
    moduleId,
    paramCount: params.length,
    paramKeys,
    presetCount: presets.length,
    presetTable: presetTable || "    { \"\", 0 }",
    presetTableSize: Math.max(presets.length, 1),
    presetValues,
    upper
  });
}

let template: string | undefined;

function readTemplate(): string {
  if (template === undefined) template = readFileSync(TEMPLATE_PATH, "utf8");
  return template;
}

function cf(value: number, label: string): string {
  return cFloatLiteral(value, label);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2] === "--check" ? "check" : "write";
  const drift = await generate({ mode });
  if (mode === "check" && drift > 0) process.exit(1);
}
