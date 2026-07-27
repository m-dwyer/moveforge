#!/usr/bin/env node
/*
 * Emit compile_commands.json for clangd / any libclang tooling.
 *
 * Every include path in this project lives inside bash string interpolation in
 * scripts/*.sh (`-Isrc -I"$MODULE_DIR/dsp"`), so without this file an editor
 * cannot resolve `#include "host/plugin_api_v1.h"` or
 * `#include "modules/_shared/mf_dsp.h"` in any module source — you get a wall of
 * false "file not found" and "undeclared identifier" diagnostics on code that
 * compiles cleanly. That hurts humans and coding agents equally, and this repo
 * is explicitly meant to be worked on by both.
 *
 * The flags mirror scripts/test.sh (the strictest build), so diagnostics in an
 * editor match what the gate will actually reject.
 *
 * Regenerate after adding a module: mise run gen-compile-commands
 */

import { access, writeFile } from "node:fs/promises";
import { selectedModuleTargets } from "./lib/modules.ts";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

type CompileCommand = {
  directory: string;
  file: string;
  arguments: string[];
};

const root = process.cwd();
const BASE = ["cc", "-std=c11", "-O2", "-g", "-Wall", "-Wextra", "-DMOVEFORGE_COUNT_NONFINITE"];

const commands: CompileCommand[] = [];

function add(file: string, includes: string[]): void {
  commands.push({
    directory: root,
    file,
    arguments: [...BASE, ...includes.flatMap((i) => ["-I", i]), "-c", file]
  });
}

/* Shared headers are header-only; clangd still needs a TU that pulls them in
 * with the right include path, which the per-module entries below provide. The
 * shared test is the one TU that includes them directly. */
add("tests/test_mf_dsp.c", ["src"]);

for (const target of await selectedModuleTargets()) {
  const dsp = `${target.paths.moduleDir}/dsp`;
  const includes = ["src", dsp];

  for (const file of [target.coreImpl, target.paths.wrapperC, target.paths.testCoreC]) {
    if (file && (await exists(file))) add(file, includes);
  }
  if (await exists(target.paths.testPluginC)) add(target.paths.testPluginC, includes);
}

/* Offline harnesses: same include shape, compiled against whichever module you
 * happen to be rendering. Pick the first module of each kind so the harness
 * itself gets accurate diagnostics. */
const targets = await selectedModuleTargets();
const harnesses: Array<[string, string | undefined]> = [
  ["tools/render_wav.c", targets.find((t) => t.componentType === "sound_generator")?.paths.moduleDir],
  ["tools/render_fx.c", targets.find((t) => t.componentType === "audio_fx")?.paths.moduleDir],
  ["tools/trace_midi_fx.c", targets.find((t) => t.componentType === "midi_fx")?.paths.moduleDir]
];
for (const [file, moduleDir] of harnesses) {
  if (moduleDir) add(file, ["src", `${moduleDir}/dsp`, "tools"]);
}

await writeFile("compile_commands.json", JSON.stringify(commands, null, 2) + "\n");
console.log(`wrote compile_commands.json (${commands.length} entries)`);
