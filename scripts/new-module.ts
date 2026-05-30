#!/usr/bin/env node
import { readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { argv, env, exit } from "node:process";
import { spawnSync } from "node:child_process";
import { renderTemplateTree, type TemplateContext } from "./lib/templates.ts";

const args = parseArgs(argv.slice(2));
const id = stringArg(args, "id");
if (!id) {
  console.error(`Usage: pnpm run new-module -- --id <module-id> [--name <DisplayName>] [--abbrev <ABC>] [--kind sound_generator|audio_fx|midi_fx] [--dsp c|faust] [--dry-run]

Scaffolds a new Schwung module by copying the matching template and
substituting MODULE_ID / MODULE_UPPER / MODULE_NAME / MODULE_ABBREV placeholders.
Also generates the per-module params header from module.json. Faust modules
also regenerate their checked-in generated C.

Arguments:
  --id      kebab/snake_case module id (required). Becomes the directory name
            and the prefix for all C functions. Must match [a-z][a-z0-9_]+.
  --name    Human-readable display name (defaults to title-cased id).
  --abbrev  3-6 char abbreviation shown in Signal Chain slot view
            (defaults to first 3 letters of id, upper-cased).
  --kind    Module kind: sound_generator, audio_fx, or midi_fx
            (default: sound_generator).
  --dsp     DSP authoring path: c or faust. Defaults to faust for
            sound_generator/audio_fx and c for midi_fx. MIDI FX modules are
            always C.
  --dry-run Print the template pack and files that would be rendered, without
            writing files, running generators, or updating src/modules/index.json.
`);
  exit(2);
}

if (!/^[a-z][a-z0-9_]*$/.test(id)) {
  console.error(`module id must match /^[a-z][a-z0-9_]*$/ (got: ${id})`);
  exit(2);
}
if (id === "_template") {
  console.error(`module id "_template" is reserved`);
  exit(2);
}

const name = stringArg(args, "name") || id.split(/[_-]/).map((p: string) => p[0].toUpperCase() + p.slice(1)).join("");
const abbrev = (stringArg(args, "abbrev") || id.slice(0, 3)).toUpperCase();
if (abbrev.length < 3 || abbrev.length > 6) {
  console.error(`--abbrev "${abbrev}" must be 3-6 characters`);
  exit(2);
}
const kind = moduleKind(stringArg(args, "kind") || "sound_generator");
const dsp = dspKind(stringArg(args, "dsp") || (kind === "midi_fx" ? "c" : "faust"));
const dryRun = args["dry-run"] === true;
if (dsp === "faust" && kind === "midi_fx") {
  console.error(`--dsp faust is not supported for midi_fx; use --dsp c`);
  exit(2);
}
const templateDir = dsp === "faust"
  ? (kind === "audio_fx" ? "templates/modules/audio_fx/faust" : "templates/modules/sound_generator/faust")
  : kind === "audio_fx" ? "templates/modules/audio_fx/c"
  : kind === "midi_fx" ? "templates/modules/midi_fx/c"
  : "templates/modules/sound_generator/c";
const upper = id.toUpperCase();
const targetDir = `src/modules/${id}`;

if (await pathExists(targetDir)) {
  console.error(`refusing to overwrite existing directory: ${targetDir}`);
  exit(1);
}
if (!dryRun && dsp === "faust" && !hasFaust()) {
  console.error(`--dsp faust requires \`faust\` on $PATH. Install Faust (e.g. \`brew install faust\`) and retry.`);
  exit(1);
}

const context: TemplateContext = {
  componentType: kind,
  dspAuthoring: dsp,
  moduleAbbrev: abbrev,
  moduleId: id,
  moduleName: name,
  moduleUpper: upper
};

const renderedFiles = await renderTemplateTree({
  context,
  dryRun,
  sourceDir: templateDir,
  targetForRelativePath: (rel) => rel.startsWith("tests/")
    ? join("tests", rel.slice("tests/".length))
    : join(targetDir, rel)
});

if (!dryRun) {
  runGenParams(id);
  runGenPresets(id);
  if (dsp === "faust") runGenFaust(id);
  runGenUiChain(id);
  await registerInIndex(id, name);
}

console.log(`${dryRun ? "would scaffold" : "scaffolded"} ${renderedFiles.length} files from ${templateDir}:`);
for (const f of renderedFiles) console.log(`  ${f.targetPath}`);
if (dryRun) exit(0);
console.log(`\nnext steps:`);
if (dsp === "faust") {
  console.log(`  1. edit ${targetDir}/dsp/${id}.dsp to implement DSP behavior`);
  console.log(`  2. edit params in ${targetDir}/module.json and matching hslider labels, then re-run \`MODULE_ID=${id} mise run gen-params && MODULE_ID=${id} mise run gen-faust && MODULE_ID=${id} mise run gen-presets\``);
} else {
  console.log(`  1. edit ${targetDir}/dsp/${id}_core.c to implement DSP behavior`);
  console.log(`  2. edit params in ${targetDir}/module.json then re-run \`MODULE_ID=${id} mise run gen-params && MODULE_ID=${id} mise run gen-presets\``);
}
console.log(`  3. add parameter tooltip descriptions to ${targetDir}/metadata.json`);
console.log(`  4. add presets to ${targetDir}/presets.json`);
console.log(`  5. MODULE_ID=${id} mise run validate && MODULE_ID=${id} mise run test`);
if (kind === "sound_generator") {
  console.log(`  6. MODULE_ID=${id} mise run suite && MODULE_ID=${id} pnpm run bless-renders`);
  console.log(`  7. MODULE_ID=${id} mise run stress`);
  console.log(`  8. MODULE_ID=${id} mise run wasm && mise run dev  (then choose ${id} in the Module selector)`);
  console.log(`  9. deploy with MODULE_ID=${id} ./scripts/install-to-move.sh`);
} else if (kind === "audio_fx") {
  console.log(`  6. MODULE_ID=${id} mise run suite && MODULE_ID=${id} pnpm run bless-renders`);
  console.log(`  7. MODULE_ID=${id} mise run stress`);
  console.log(`  8. MODULE_ID=${id} mise run wasm && mise run dev  (route audio into ${id} in the chain)`);
  console.log(`  9. deploy with MODULE_ID=${id} ./scripts/install-to-move.sh`);
} else {
  console.log(`  6. MODULE_ID=${id} mise run suite && MODULE_ID=${id} pnpm run bless-renders  (compares MIDI traces)`);
  console.log(`  7. MODULE_ID=${id} mise run wasm  (browser audition needs a downstream synth in the chain)`);
  console.log(`  8. deploy with MODULE_ID=${id} ./scripts/install-to-move.sh`);
}

function parseArgs(list: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < list.length; i++) {
    const arg = list[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = list[i + 1];
    if (!next || next.startsWith("--")) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

function stringArg(args: Record<string, string | true>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
}

function moduleKind(value: string): "sound_generator" | "audio_fx" | "midi_fx" {
  if (value === "sound_generator" || value === "audio_fx" || value === "midi_fx") return value;
  console.error(`--kind must be sound_generator, audio_fx, or midi_fx (got: ${value})`);
  exit(2);
}

function dspKind(value: string): "c" | "faust" {
  if (value === "c" || value === "faust") return value;
  console.error(`--dsp must be c or faust (got: ${value})`);
  exit(2);
}

function runGenParams(moduleId: string): void {
  const result = spawnSync(process.execPath, ["scripts/gen-params.ts"], {
    stdio: "inherit",
    env: { ...env, MODULE_ID: moduleId }
  });
  if (result.status !== 0) {
    console.error(`gen-params failed for ${moduleId}`);
    exit(result.status ?? 1);
  }
}

function runGenFaust(moduleId: string): void {
  const result = spawnSync(process.execPath, ["scripts/gen-faust.ts"], {
    stdio: "inherit",
    env: { ...env, MODULE_ID: moduleId }
  });
  if (result.status !== 0) {
    console.error(`gen-faust failed for ${moduleId}`);
    exit(result.status ?? 1);
  }
}

function runGenPresets(moduleId: string): void {
  const result = spawnSync(process.execPath, ["scripts/gen-presets.ts"], {
    stdio: "inherit",
    env: { ...env, MODULE_ID: moduleId }
  });
  if (result.status !== 0) {
    console.error(`gen-presets failed for ${moduleId}`);
    exit(result.status ?? 1);
  }
}

function runGenUiChain(moduleId: string): void {
  const result = spawnSync(process.execPath, ["scripts/gen-ui-chain.ts"], {
    stdio: "inherit",
    env: { ...env, MODULE_ID: moduleId }
  });
  if (result.status !== 0) {
    console.error(`gen-ui-chain failed for ${moduleId}`);
    exit(result.status ?? 1);
  }
}

function hasFaust(): boolean {
  const result = spawnSync("faust", ["--version"], { stdio: "ignore" });
  return result.status === 0;
}

async function pathExists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch { return false; }
}

async function registerInIndex(id: string, name: string): Promise<void> {
  const path = "src/modules/index.json";
  const index = JSON.parse(await readFile(path, "utf8")) as { modules: Array<{ id: string; name: string; kind: string }> };
  if (index.modules.some((m) => m.id === id)) return;
  index.modules.push({ id, name, kind });
  index.modules.sort((a, b) => a.id.localeCompare(b.id));
  await writeFile(path, JSON.stringify(index, null, 2) + "\n");
}
