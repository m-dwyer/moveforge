#!/usr/bin/env node
/**
 * Emscripten-compile the browser modules.
 *
 * Replaces scripts/build-wasm.sh, whose real complexity was not the emcc call
 * but its hand-maintained SHARED_DEPS_SG / SHARED_DEPS_FX / SHARED_DEPS_MIDI_FX
 * arrays — the list of headers whose edits should invalidate a .wasm. Its own
 * comment recorded why that was dangerous: an omission there is a correctness
 * bug, not a slow build. The build prints "cached", the browser keeps the stale
 * .wasm, and a newly added parameter's <id>_param_id() still returns -1, so the
 * knob silently does nothing. ninja gets that list from emcc itself via -MMD, so
 * there is no longer a list to get wrong.
 */
import { fileURLToPath } from "node:url";

import { commandExists, die } from "./lib/exec.ts";
import { dockerAvailable, runNinjaInContainer, runNinjaLocally } from "./lib/container.ts";
import { readModuleTarget, selectedModuleTargets } from "./lib/modules.ts";
import { generateNinjaFiles } from "./gen-ninja.ts";
import { EMSCRIPTEN_IMAGE } from "./lib/toolchains.ts";

const NINJA_FILE = "build/wasm.ninja";

export type BuildWasmOptions = {
  /** Build just this module. Defaults to the MODULE_ID selection, or all. */
  moduleId?: string | null;
  /** Extra arguments for ninja. */
  ninjaArgs?: string[];
};

/**
 * Importable entry point, so vite.config.ts's rebuild-on-save hook can call this
 * in-process rather than spawning a Node process from a Node process — and get a
 * catchable exception with a real stack instead of an exit code.
 */
export async function buildWasm(options: BuildWasmOptions = {}): Promise<void> {
  const forwarded = options.ninjaArgs ?? [];
  await generateNinjaFiles();

  const modules = options.moduleId
    ? [await readModuleTarget(options.moduleId)]
    : await selectedModuleTargets();
  const buildable = modules.filter((module) => module.wasmGlue);
  for (const module of modules) {
    if (!module.wasmGlue) {
      console.log(`skip   ${module.id} (component_type=${module.componentType} — no WASM path)`);
    }
  }
  if (buildable.length === 0) return;

  const targets = buildable.map((module) => `web/wasm/${module.id}.wasm`);

  if (await commandExists("emcc")) {
    await runNinjaLocally(NINJA_FILE, targets, forwarded);
  } else if (await dockerAvailable()) {
    await runNinjaInContainer({
      image: EMSCRIPTEN_IMAGE,
      dockerfile: "scripts/Dockerfile.emsdk",
      ninjaFile: NINJA_FILE,
      targets,
      root: process.cwd(),
      ninjaArgs: forwarded
    });
  } else {
    die("build-wasm: needs Docker, or emcc on PATH (see https://emscripten.org).");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await buildWasm({ ninjaArgs: process.argv.slice(2) });
}
