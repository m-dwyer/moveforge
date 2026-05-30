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
import { generate as genParams } from "./gen-params.ts";
import { generate as genFaust } from "./gen-faust.ts";
import { generate as genPresets } from "./gen-presets.ts";
import { generate as genUiChain } from "./gen-ui-chain.ts";

let drift = 0;
drift += await genParams({ mode: "check" });
drift += await genFaust({ mode: "check" });
drift += await genPresets({ mode: "check" });
drift += await genUiChain({ mode: "check" });
if (drift > 0) process.exit(1);

// These scripts self-execute on import and exit non-zero on failure.
await import("./validate-params.ts");
await import("./check-module-targets.ts");
