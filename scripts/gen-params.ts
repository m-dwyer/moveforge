import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type ModuleParam, type ScopeConfig } from "../shared/module-schema.ts";
import { flattenParams } from "../shared/ui-hierarchy.ts";
import { modulePaths, readModuleJson, selectedModuleIds } from "./lib/modules.ts";
import { cFloatLiteral } from "./lib/c.ts";
import { renderGenerated } from "./lib/eta.ts";
import { type GenerateOptions, writeGeneratedFile } from "./lib/generated-files.ts";

const SCOPE_STYLE: Record<string, string> = {
  envelope: "MF_SCOPE_ENVELOPE",
  triggered: "MF_SCOPE_TRIGGERED",
  line: "MF_SCOPE_LINE",
  none: "MF_SCOPE_NONE"
};

const SCOPE_MODE: Record<string, string> = {
  continuous: "MF_SCOPE_CONTINUOUS",
  oneshot: "MF_SCOPE_ONESHOT"
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
    const moduleJson = await readModuleJson(moduleId);
    const params = flattenParams<ModuleParam>(moduleJson.capabilities.ui_hierarchy);
    if (params.length === 0) {
      console.warn(`[${moduleId}] no params in any capabilities.ui_hierarchy level — skipping`);
      continue;
    }

    drift += await writeGeneratedFile({
      generated: renderHeader(moduleId, params),
      mode,
      moduleId,
      outPath: paths.paramsGenH,
      staleMessage: "run `mise run gen-params`",
      writeMessage: `wrote ${paths.paramsGenH}`
    });

    const generated = renderInc(moduleId, params, existsSync(paths.faustDsp));
    drift += await writeGeneratedFile({
      generated,
      mode,
      moduleId,
      outPath: paths.paramsGenInc,
      staleMessage: "run `mise run gen-params`",
      writeMessage: `wrote ${paths.paramsGenInc} (${params.length} param${params.length === 1 ? "" : "s"})`
    });

    // capabilities.scope is the single source of truth for the output scope;
    // emit the wrapper's style/mode/window macros from it.
    const scope = moduleJson.capabilities.scope;
    if (scope) {
      drift += await writeGeneratedFile({
        generated: renderScopeInc(moduleId, scope),
        mode,
        moduleId,
        outPath: paths.scopeGenInc,
        staleMessage: "run `mise run gen-params`",
        writeMessage: `wrote ${paths.scopeGenInc}`
      });
    }
  }

  return drift;
}

function renderScopeInc(moduleId: string, scope: ScopeConfig): string {
  const styleKey = scope.style ?? "envelope";
  const modeKey = scope.mode ?? "continuous";
  const style = SCOPE_STYLE[styleKey];
  const mode = SCOPE_MODE[modeKey];
  if (!style) console.warn(`[${moduleId}] unknown scope.style "${styleKey}" — defaulting to envelope`);
  if (!mode) console.warn(`[${moduleId}] unknown scope.mode "${modeKey}" — defaulting to continuous`);
  return renderGenerated("scope.gen.inc", {
    mode: mode ?? "MF_SCOPE_CONTINUOUS",
    moduleId,
    style: style ?? "MF_SCOPE_ENVELOPE",
    upper: moduleId.toUpperCase(),
    window: Number.isFinite(scope.window) ? Math.round(scope.window as number) : 1024
  });
}

/**
 * The context every params template gets: the params themselves, plus the
 * naming and literal-formatting rules bound to this module.
 *
 * `enumName` and `cf` are passed in rather than inlined in the template because
 * they are contracts, not formatting. The enum name is an ABI shared with the
 * device's knob list and the browser's parameter ids, and cFloatLiteral has to
 * emit a literal C reads back as the same float — `${p.min}` would silently
 * produce `0.10000000149011612` where the C wants `0.1f`.
 */
function templateContext(moduleId: string, params: ModuleParam[]) {
  const upper = moduleId.toUpperCase();
  return {
    cf: (value: number) => cFloatLiteral(value, "param value"),
    coreType: `${moduleId}_core_t`,
    enumName: (key: string) => `${upper}_PARAM_${key.toUpperCase()}`,
    moduleId,
    params,
    upper
  };
}

/* The param count and enum live in their own header so <id>_core.h can size
 * arrays indexed by param id (e.g. a Faust adapter's zones[]) from the
 * generated count rather than a hand-maintained literal. */
function renderHeader(moduleId: string, params: ModuleParam[]): string {
  return renderGenerated("params.gen.h", {
    ...templateContext(moduleId, params),
    guard: `${moduleId.toUpperCase()}_PARAMS_GEN_H`
  });
}

function renderInc(moduleId: string, params: ModuleParam[], isFaust: boolean): string {
  return renderGenerated("params.gen.inc", {
    ...templateContext(moduleId, params),
    guard: `${moduleId.toUpperCase()}_PARAMS_GEN_INC`,
    isFaust
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2] === "--check" ? "check" : "write";
  const drift = await generate({ mode });
  if (mode === "check" && drift > 0) process.exit(1);
}
