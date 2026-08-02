import { copyFile, mkdir } from "node:fs/promises";

import { fileExists, type ModuleBuildTarget } from "./modules.ts";
import { run } from "./exec.ts";

/**
 * Assemble the directory Schwung actually loads from, given a built .so.
 *
 * Compiling and packaging are separate on purpose: ninja owns "is the .so up to
 * date", and this owns "what goes in the shipped directory". Folding the copy
 * into the compile — as build.sh did — meant the packaging step reran only when
 * the compiler did, so editing ui.js or presets.json produced no new dist/.
 */
export async function packageModule(
  module: ModuleBuildTarget,
  sharedObject: string,
  distDir: string
): Promise<string> {
  const target = `${distDir}/${module.id}`;
  await mkdir(target, { recursive: true });

  await copyFile(module.paths.moduleJson, `${target}/module.json`);
  await copyFile(`${module.paths.moduleDir}/ui.js`, `${target}/ui.js`);
  await copyFile(sharedObject, `${target}/dsp.so`);

  for (const optional of ["ui_chain.js", "presets.json"]) {
    const source = `${module.paths.moduleDir}/${optional}`;
    if (await fileExists(source)) await copyFile(source, `${target}/${optional}`);
  }
  return target;
}

/**
 * Device packaging additionally ships the .so under a second name.
 *
 * The synth chain host dlopens "<module>/dsp.so"; the audio-FX chain host
 * hardcodes "<module>/<id>.so" (chain_host.c load_audio_fx, ignoring
 * module.json's "dsp"). Shipping both satisfies whichever path the host uses for
 * this module's kind.
 */
export async function packageForDevice(
  module: ModuleBuildTarget,
  sharedObject: string
): Promise<string> {
  const target = await packageModule(module, sharedObject, "dist");
  await copyFile(sharedObject, `${target}/${module.id}.so`);
  await run("tar", ["-czf", `${module.id}-module.tar.gz`, module.id], { cwd: "dist" });
  return target;
}
