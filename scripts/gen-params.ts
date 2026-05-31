import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { modulePaths, selectedModuleIds } from "./lib/modules.ts";
import { cFloatLiteral } from "./lib/c.ts";
import { renderTemplateString } from "./lib/templates.ts";
import { type GenerateOptions, writeGeneratedFile } from "./lib/generated-files.ts";

const TEMPLATE_PATH = "templates/generated/params.gen.inc.tmpl";

type Param = {
  default: number;
  key: string;
  max: number;
  min: number;
  name?: string;
  step?: number;
  type: string;
};

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

/**
 * Generate (or check) each module's <module>_params.gen.inc from module.json.
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

    const generated = renderInc(moduleId, params);
    drift += await writeGeneratedFile({
      generated,
      mode,
      moduleId,
      outPath: paths.paramsGenInc,
      staleMessage: "run `mise run gen-params`",
      writeMessage: `wrote ${paths.paramsGenInc} (${params.length} param${params.length === 1 ? "" : "s"})`
    });
  }

  return drift;
}

function renderInc(moduleId: string, params: Param[]): string {
  const upper = moduleId.toUpperCase();
  const coreT = `${moduleId}_core_t`;
  const guard = `${upper}_PARAMS_GEN_INC`;

  const enumEntries = params.map((p, i) => `    ${enumName(upper, p.key)} = ${i}`).join(",\n");

  const idLookup = params
    .map((p) => `    if (strcmp(key, "${p.key}") == 0) return ${enumName(upper, p.key)};`)
    .join("\n");

  const setCases = params
    .map(
      (p) =>
        `        case ${enumName(upper, p.key)}: s->${p.key} = ${moduleId}_params_clampf_(value, ${cf(p.min, "param value")}, ${cf(p.max, "param value")}); break;`
    )
    .join("\n");

  const getCases = params
    .map((p) => `        case ${enumName(upper, p.key)}: return s->${p.key};`)
    .join("\n");

  const defaults = params.map((p) => `    s->${p.key} = ${cf(p.default, "param value")};`).join("\n");

  return renderTemplateString(readTemplate(), {
    coreType: coreT,
    defaults,
    enumEntries,
    getCases,
    guard,
    idLookup,
    moduleId,
    setCases
  });
}

let template: string | undefined;

function readTemplate(): string {
  if (template === undefined) template = readFileSync(TEMPLATE_PATH, "utf8");
  return template;
}

function enumName(upper: string, key: string): string {
  return `${upper}_PARAM_${key.toUpperCase()}`;
}

function cf(value: number, label: string): string {
  return cFloatLiteral(value, label);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2] === "--check" ? "check" : "write";
  const drift = await generate({ mode });
  if (mode === "check" && drift > 0) process.exit(1);
}
