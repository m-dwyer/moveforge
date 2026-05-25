#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { argv, exit } from "node:process";

const TEMPLATE_DIR = "src/modules/_template";

const args = parseArgs(argv.slice(2));
const id = stringArg(args, "id");
if (!id) {
  console.error(`Usage: node scripts/new-module.ts --id <module-id> [--name <DisplayName>] [--abbrev <AB>]

Scaffolds a new sound_generator module by copying src/modules/_template/ and
substituting MODULE_ID / MODULE_UPPER / MODULE_NAME / MODULE_ABBREV placeholders.

Arguments:
  --id      kebab/snake_case module id (required). Becomes the directory name
            and the prefix for all C functions. Must match [a-z][a-z0-9_]+.
  --name    Human-readable display name (defaults to title-cased id).
  --abbrev  2-letter abbreviation (defaults to first 2 letters of id, upper-cased).

Audio FX modules are not scaffolded yet — see docs/audio-fx-template.md for the wrapper pattern.
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
const abbrev = (stringArg(args, "abbrev") || id.slice(0, 2)).toUpperCase();
const upper = id.toUpperCase();
const targetDir = `src/modules/${id}`;

if (await pathExists(targetDir)) {
  console.error(`refusing to overwrite existing directory: ${targetDir}`);
  exit(1);
}

const replacements = {
  MODULE_UPPER: upper,
  MODULE_ABBREV: abbrev,
  MODULE_NAME: name,
  MODULE_ID: id
};

const filesCopied = [];
for await (const file of walk(TEMPLATE_DIR)) {
  const rel = relative(TEMPLATE_DIR, file);
  const renamed = applySubs(rel, replacements);

  const targetPath = rel.startsWith("tests/")
    ? join("tests", applySubs(rel.slice("tests/".length), replacements))
    : join(targetDir, renamed);

  const content = await readFile(file, "utf8");
  const transformed = applySubs(content, replacements);
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, transformed);
  filesCopied.push(targetPath);
}

await registerInIndex(id, name);

console.log(`scaffolded ${filesCopied.length} files:`);
for (const f of filesCopied) console.log(`  ${f}`);
console.log(`\nnext steps:`);
console.log(`  1. edit ${targetDir}/dsp/${id}_core.c to implement synthesis`);
console.log(`  2. add presets to ${targetDir}/presets.json (each "render" block produces a suite WAV)`);
console.log(`  3. mise run validate && mise run test`);
console.log(`  4. MODULE_ID=${id} mise run suite && node scripts/check-renders.ts bless`);
console.log(`  5. MODULE_ID=${id} mise run wasm && mise run serve  (then open /web/?module=${id})`);

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

function applySubs(s: string, subs: Record<string, string>): string {
  let out = s;
  for (const [key, val] of Object.entries(subs)) {
    out = out.split(key).join(val);
  }
  return out;
}

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch { return false; }
}

async function registerInIndex(id: string, name: string): Promise<void> {
  const path = "src/modules/index.json";
  const index = JSON.parse(await readFile(path, "utf8")) as { modules: Array<{ id: string; name: string; kind: string }> };
  if (index.modules.some((m) => m.id === id)) return;
  index.modules.push({ id, name, kind: "sound_generator" });
  index.modules.sort((a, b) => a.id.localeCompare(b.id));
  await writeFile(path, JSON.stringify(index, null, 2) + "\n");
}
