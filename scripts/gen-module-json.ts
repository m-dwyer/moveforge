/*
 * Generate src/modules/<id>/module.json from module.def.json.
 *
 * module.def.json is the authored definition and answers to no host
 * (shared/module-definition.ts). module.json is what the Schwung host parses on
 * the device, so it is a build artifact of the Schwung target — the same
 * relationship <id>_params.gen.inc has to the parameters, one level up.
 *
 * The emitter itself is shared/targets/schwung-emit.ts, kept free of node:fs so
 * the browser can call it too. This file is the part that reads and writes.
 */
import { fileURLToPath } from "node:url";

import { emitSchwungModuleJson } from "../shared/targets/schwung-emit.ts";
import { formatJson } from "./lib/json-format.ts";
import { modulePaths, readModuleDefinition, selectedModuleIds } from "./lib/modules.ts";
import { type GenerateOptions, writeGeneratedFile } from "./lib/generated-files.ts";

/**
 * Generate (or check) each module's module.json from its definition.
 * Returns the number of modules whose generated output is stale (0 when in sync).
 */
export async function generate(options: GenerateOptions = {}): Promise<number> {
  const mode = options.mode ?? "write";
  const moduleIds = options.moduleIds ?? (await selectedModuleIds());

  let drift = 0;
  for (const moduleId of moduleIds) {
    const paths = modulePaths(moduleId);
    const definition = await readModuleDefinition(moduleId);
    if (definition.id !== moduleId) {
      throw new Error(
        `${paths.moduleDef}: id "${definition.id}" does not match its directory "${moduleId}"`
      );
    }

    drift += await writeGeneratedFile({
      generated: formatJson(emitSchwungModuleJson(definition)),
      mode,
      moduleId,
      outPath: paths.moduleJson,
      staleMessage: "run `mise run gen-module-json`",
      writeMessage: `wrote ${paths.moduleJson}`
    });
  }

  return drift;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2] === "--check" ? "check" : "write";
  const drift = await generate({ mode });
  if (mode === "check" && drift > 0) process.exit(1);
}
