#!/usr/bin/env node
/**
 * Build the host-only shared libraries and stage dist-host/<id>/.
 *
 * Replaces scripts/build-host.sh. Compilation is build/host.ninja's `hostlib`
 * target; this is the packaging around it.
 */
import { fileURLToPath } from "node:url";

import { runNinjaLocally } from "./lib/container.ts";
import { packageModule } from "./lib/package-dist.ts";
import { generateNinjaFiles } from "./gen-ninja.ts";
import { selectedModuleTargets } from "./lib/modules.ts";

async function main(): Promise<void> {
  const forwarded = process.argv.slice(2);
  await generateNinjaFiles();

  const modules = await selectedModuleTargets();
  await runNinjaLocally(
    "build/host.ninja",
    modules.map((module) => `build-host/${module.id}-dsp.so`),
    forwarded
  );

  for (const module of modules) {
    const target = await packageModule(module, `build-host/${module.id}-dsp.so`, "dist-host");
    console.log(`Host-only build complete: ${target}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
