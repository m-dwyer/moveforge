#!/usr/bin/env node
/**
 * Cross-compile every selected module for the device, and package dist/<id>/.
 *
 * Replaces scripts/build.sh. That script re-invoked *itself* inside the
 * cross-compile container, because the container has no JS runtime and the
 * module work-list had to be resolved by node on the host — which is why it also
 * carried a TSV manifest handoff and a 20-line "find a usable node" search that
 * worked around `node` being shadowed under make. None of that is needed now:
 * the module graph is resolved here, written into build/move.ninja, and the
 * container only ever runs `ninja`.
 */
import { fileURLToPath } from "node:url";

import { commandExists, die } from "./lib/exec.ts";
import { dockerAvailable, runNinjaInContainer, runNinjaLocally } from "./lib/container.ts";
import { packageForDevice } from "./lib/package-dist.ts";
import { generateNinjaFiles } from "./gen-ninja.ts";
import { selectedModuleTargets } from "./lib/modules.ts";
import { CROSS_IMAGE, CROSS_PREFIX } from "./lib/toolchains.ts";

const NINJA_FILE = "build/move.ninja";

async function main(): Promise<void> {
  const forwarded = process.argv.slice(2);
  await generateNinjaFiles();
  const modules = await selectedModuleTargets();
  const targets = modules.map((module) => `build/${module.id}-dsp.so`);

  // A local cross toolchain wins over Docker: it is faster, and someone who has
  // installed one has said what they want. SCHWUNG_NO_DOCKER forces that path.
  const localCompiler = `${CROSS_PREFIX}gcc`;
  if (await commandExists(localCompiler)) {
    await runNinjaLocally(NINJA_FILE, targets, forwarded);
  } else if (process.env.SCHWUNG_NO_DOCKER) {
    die(
      `build-move: SCHWUNG_NO_DOCKER is set but ${localCompiler} is not on PATH.\n` +
        `Install an aarch64 Linux toolchain, or unset SCHWUNG_NO_DOCKER to build in Docker.`
    );
  } else if (await dockerAvailable()) {
    await runNinjaInContainer({
      image: CROSS_IMAGE,
      dockerfile: "scripts/Dockerfile",
      ninjaFile: NINJA_FILE,
      targets,
      root: process.cwd(),
      ninjaArgs: forwarded
    });
  } else {
    die(
      `build-move: no way to cross-compile.\n` +
        `Install Docker, or install an aarch64 Linux toolchain (${localCompiler}),\n` +
        `or run \`mise run host-build\` for local-only experiments.`
    );
  }

  for (const module of modules) {
    await packageForDevice(module, `build/${module.id}-dsp.so`);
    console.log(`packaged dist/${module.id}-module.tar.gz`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
