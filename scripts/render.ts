#!/usr/bin/env node
/**
 * Build the offline render harnesses and render.
 *
 * Replaces scripts/render-demo.sh, which was mostly a three-way copy of the same
 * `cc` line — one per component_type — plus environment plumbing. The compile is
 * now build/host.ninja's `renders` target, and RENDER_BIN/RENDER_KIND are gone:
 * render-suite.ts and render-stress.ts already resolve both from
 * scripts/lib/modules.ts and already iterate the selected modules, so the shell
 * was passing them values they were about to derive anyway.
 *
 *   render.ts             demo render for each module
 *   render.ts --suite     ...and the full preset suite
 *   render.ts --stress    ...and the metadata-generated min/max stress renders
 */
import { fileURLToPath } from "node:url";
import { mkdir, rm } from "node:fs/promises";

import { die, run } from "./lib/exec.ts";
import { runNinjaLocally } from "./lib/container.ts";
import { selectedModuleTargets } from "./lib/modules.ts";
import { generateNinjaFiles } from "./gen-ninja.ts";

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode && mode !== "--suite" && mode !== "--stress") {
    die(`render: unknown argument ${mode} (expected --suite or --stress)`);
  }

  await generateNinjaFiles();
  const modules = await selectedModuleTargets();
  const renderable = modules.filter((module) => module.renderKind);

  for (const module of modules) {
    if (!module.renderKind) {
      console.error(
        `[${module.id}] skipping render: component_type='${module.componentType}' ` +
          `(no offline harness for this kind)`
      );
    }
  }
  if (renderable.length === 0) return;

  await runNinjaLocally(
    "build/host.ninja",
    renderable.map((module) => module.renderBin.replace(/^\.\//, ""))
  );
  await mkdir("renders", { recursive: true });

  for (const module of renderable) {
    await run(module.renderBin, [module.renderDemoOut]);
  }

  if (!mode) return;

  // Clear the output directory first. render-suite.ts and render-stress.ts only
  // mkdir, so without this a preset deleted from presets.json leaves its WAV
  // behind and keeps being picked up by metrics and the golden comparison.
  const suite = mode === "--suite";
  for (const module of renderable) {
    if (!suite && !module.supportsStress) continue;
    const dir = suite ? module.paths.suiteDir : module.paths.stressDir;
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
  }

  await run("node", [suite ? "scripts/render-suite.ts" : "scripts/render-stress.ts"]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
