/*
 * Generate <module>/ui_chain.js from module.json.
 *
 * A Schwung module must ship a real ui_chain.js to be openable (wheel press)
 * in a chain slot: the host loads ui_chain.js and renders the detail screen
 * only if it sets globalThis.chain_ui with a tick() that draws. An empty/no-op
 * chain_ui (the old template stub) draws nothing — the slot appears dead.
 *
 * This emits a scrollable parameter editor with optional 8-encoder banks:
 * the jog wheel scrolls/selects/edits one focused row, and Knob 1..8 adjust
 * the active bank declared by the `knobs` order of module.json's ui_hierarchy
 * levels. Param metadata is taken from module.json so it never drifts.
 *
 * GENERATED FILE — do not hand-edit <module>/ui_chain.js; edit module.json and
 * re-run `mise run gen-ui-chain`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type ModuleJson, type ModuleParam } from "../shared/module-schema.ts";
import { flattenKnobs, flattenParams } from "../shared/ui-hierarchy.ts";
import { renderTemplateString } from "./lib/templates.ts";
import { modulePaths, readModuleJson, selectedModuleIds } from "./lib/modules.ts";
import { type GenerateOptions, writeGeneratedFile } from "./lib/generated-files.ts";

const TEMPLATE_PATH = "templates/generated/ui_chain.js.tmpl";

const EDITABLE_TYPES = new Set(["sound_generator", "audio_fx", "midi_fx"]);
const ENCODER_COUNT = 8; // Move parameter encoders, CC 71-78

/* Knob detents across a param's range. Continuous controls use normalized
 * full-range travel; discrete selectors keep their declared step. */
function editStep(p: ModuleParam): number {
  const range = p.max - p.min;
  if (range <= 0) return 0.01;
  const declared = p.step ?? 0;
  if (isDiscreteParam(p)) return declared > 0 ? declared : 1;
  return range / 100;
}

function isDiscreteParam(p: ModuleParam): boolean {
  const type = (p.type ?? "").toLowerCase();
  if (type === "int" || type === "enum" || type === "bool") return true;
  return (p.step ?? 0) >= 1;
}

function decimalsFor(step: number): number {
  if (step >= 1) return 0;
  if (step >= 0.1) return 1;
  return 2;
}

function renderUiChain(id: string, json: ModuleJson, params: ModuleParam[]): string {
  const name = json.name ?? id;
  const requestedKnobs = flattenKnobs(json.capabilities?.ui_hierarchy);
  const paramIndexByKey = new Map(params.map((p, i) => [p.key, i]));
  const knobIndexes = (requestedKnobs.length > 0 ? requestedKnobs : params.map((p) => p.key))
    .map((key) => paramIndexByKey.get(key))
    .filter((index): index is number => index !== undefined);
  const rows = params
    .map((p) => {
      const step = editStep(p);
      const dec = decimalsFor(step);
      const label = p.name ?? p.key;
      return `    { key: ${JSON.stringify(p.key)}, name: ${JSON.stringify(label)}, ` +
        `min: ${p.min}, max: ${p.max}, step: ${round(step)}, dec: ${dec}, def: ${p.default} }`;
    })
    .join(",\n");
  const knobRows = knobIndexes.map((index) => `    ${index}`).join(",\n");

  return renderTemplateString(readUiChainTemplate(), {
    encoderCount: ENCODER_COUNT,
    knobIndexRows: knobRows,
    moduleName: name,
    moduleNameJson: JSON.stringify(name),
    paramsRows: rows
  });
}

let uiChainTemplate: string | undefined;

function readUiChainTemplate(): string {
  if (uiChainTemplate === undefined) {
    uiChainTemplate = readFileSync(TEMPLATE_PATH, "utf8");
  }
  return uiChainTemplate;
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/**
 * Generate (or check) each editable module's ui_chain.js from module.json.
 * Modules without editable params (e.g. settings/tool modules) are skipped.
 * Returns the number of modules whose generated output is stale (0 when in sync).
 */
export async function generate(options: GenerateOptions = {}): Promise<number> {
  const mode = options.mode ?? "write";
  const moduleIds = options.moduleIds ?? (await selectedModuleIds());

  let drift = 0;
  for (const id of moduleIds) {
    const paths = modulePaths(id);
    const json = await readModuleJson(id);
    const ct = json.capabilities.component_type;
    const params = flattenParams<ModuleParam>(json.capabilities.ui_hierarchy);

    const outPath = `${paths.moduleDir}/ui_chain.js`;

    if (!EDITABLE_TYPES.has(ct) || params.length === 0) {
      continue; // nothing to render (e.g. settings/tool modules)
    }

    const generated = renderUiChain(id, json, params);
    drift += await writeGeneratedFile({
      generated,
      mode,
      moduleId: id,
      outPath,
      staleMessage: "run `mise run gen-ui-chain`",
      writeMessage: `wrote ${outPath} (${params.length} params)`
    });
  }

  return drift;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2] === "--check" ? "check" : "write";
  const drift = await generate({ mode });
  if (mode === "check" && drift > 0) process.exit(1);
}
