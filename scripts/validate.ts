/*
 * Run all non-device validation checks in a single process.
 *
 * The four code generators are imported and run in "check" mode (they report
 * drift and return a count instead of spawning a subprocess each). The two
 * remaining checks self-execute on import and process.exit(1) on failure, so
 * importing them runs them in-process, in the same order as before.
 *
 * Equivalent to the old chain:
 *   gen-params --check && gen-faust --check && gen-presets --check &&
 *   gen-ui-chain --check && validate-params && check-module-targets
 */
import { ModuleSchemaError } from "../shared/module-schema.ts";
import { generate as genParams } from "./gen-params.ts";
import { generate as genFaust } from "./gen-faust.ts";
import { generate as genPresets } from "./gen-presets.ts";
import { generate as genUiChain } from "./gen-ui-chain.ts";

/*
 * The generators read module.json through the schema, so a structurally broken
 * file throws here — before validate-params.ts, which is the thing that knows
 * how to report a problem to a human, has been imported. Left alone that turns
 * the most common authoring mistake into a stack trace. Catch it and print the
 * same shape validate-params.ts prints; it is the same information either way,
 * and the trace through parseWith -> readModuleJson -> generate says nothing a
 * reader of a malformed module.json needs.
 */
let drift = 0;
try {
  drift += await genParams({ mode: "check" });
  drift += await genFaust({ mode: "check" });
  drift += await genPresets({ mode: "check" });
  drift += await genUiChain({ mode: "check" });
} catch (err) {
  if (!(err instanceof ModuleSchemaError)) throw err;
  console.error("Module validation failed:\n");
  console.error(`${err.source}:`);
  for (const issue of err.issues) {
    console.error(`- ${issue.path || "<root>"}: ${issue.message}`);
  }
  process.exit(1);
}
if (drift > 0) process.exit(1);

// These scripts self-execute on import and exit non-zero on failure.
await import("./validate-params.ts");
await import("./check-module-targets.ts");
