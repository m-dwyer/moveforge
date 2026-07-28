import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { flattenParams, type UiHierarchy } from "../shared/ui-hierarchy.ts";
import { selectedModuleTargets } from "./lib/modules.ts";

type Param = {
  key: string;
  name: string;
  type: string;
  min: number;
  max: number;
  default: number;
};

type ModuleJson = {
  capabilities?: {
    component_type?: string;
    ui_hierarchy?: UiHierarchy<Param>;
  };
};

type StressCase = {
  file: string;
  label: string;
  expect_silence?: boolean;
  velocity?: number;
  params: Record<string, number>;
};

/* Which notes to play a sound generator.
 *
 * This was hardcoded to "36,43,48,55,60", which is fine for a module where every
 * note plays the same voice and useless for one where notes *select* a voice: swarf
 * maps six voices to root..root+5, so of those five notes only 36 landed on anything
 * and fourteen of its stress gates failed for reasons that were all the harness's.
 * A module that declares a `root` note-block parameter gets its whole block, read
 * from that case's own value so the `root` min/max cases move the notes with it. */
function stressNotes(params: Param[], values: Record<string, number>): string {
  const root = params.find((param) => param.key === "root");
  if (!root) return "36,43,48,55,60";
  const base = Math.round(values.root ?? root.default);
  return Array.from({ length: 6 }, (_, i) => Math.min(127, base + i)).join(",");
}

type StressManifest = {
  module_id: string;
  component_type: string;
  cases: StressCase[];
};

for (const target of await selectedModuleTargets()) {
  const moduleId = target.id;
  const paths = target.paths;
  const moduleJson = JSON.parse(await readFile(paths.moduleJson, "utf8")) as ModuleJson;
  const componentType = target.componentType;
  const params = flattenParams(moduleJson.capabilities?.ui_hierarchy);

  if (componentType !== "sound_generator" && componentType !== "audio_fx") {
    console.log(`[${moduleId}] skipping stress render: component_type='${componentType}'`);
    continue;
  }

  const renderBin = process.env.RENDER_BIN || target.renderBin;
  const stressDir = paths.stressDir;
  await mkdir(stressDir, { recursive: true });

  const defaults = Object.fromEntries(params.map((param) => [param.key, param.default]));
  const cases = buildCases(params, defaults, componentType);

  for (const stressCase of cases) {
    const outPath = join(stressDir, stressCase.file);
    const args = componentType === "audio_fx"
      ? [outPath, "--signal", stressCase.file.includes("impulse") ? "impulse" : "sweep", "--seconds", "4"]
      : ["--render", outPath, "5", "36", "18", String(stressCase.velocity ?? 127),
         stressNotes(params, stressCase.params)];

    for (const [key, value] of Object.entries(stressCase.params)) {
      args.push(`${key}=${value}`);
    }

    const result = spawnSync(renderBin, args, { stdio: "inherit" });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }

  const manifest: StressManifest = {
    module_id: moduleId,
    component_type: componentType,
    cases
  };
  await writeFile(join(stressDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`[${moduleId}] wrote ${cases.length} stress render(s) to ${stressDir}`);
}

function buildCases(params: Param[], defaults: Record<string, number>, kind: string): StressCase[] {
  const cases: StressCase[] = [];
  const add = (label: string, values: Record<string, number>, expectSilence = false,
               velocity?: number) => {
    cases.push({
      file: `${String(cases.length).padStart(2, "0")}-${slug(label)}.wav`,
      label,
      expect_silence: expectSilence || undefined,
      velocity,
      params: values
    });
  };

  add("Default", { ...defaults });

  for (const param of params) {
    if (param.min !== param.default) {
      add(`${param.name} Min`, { ...defaults, [param.key]: param.min }, isSilencingParam(param, param.min, kind));
    }
    if (param.max !== param.default) {
      add(`${param.name} Max`, { ...defaults, [param.key]: param.max }, isSilencingParam(param, param.max, kind));
    }
  }

  const allMax = Object.fromEntries(params.map((param) => [param.key, param.max]));
  add("All Max", allMax,
      (kind === "sound_generator" && hasSlowMaxAttack(params)) ||
      params.some((param) => silencesAtMax(param.key)));

  const hot = { ...defaults };
  for (const param of params) {
    /* Anchored. Unanchored, this matched every per-voice `hat_level` and
     * `conga_strike` as well as the master `volume`, so "Hot Fast" on a six-voice
     * module was All Max with a different name — and it is checked by gates that
     * fail on any clipped sample. */
    if (/^(volume|level|mix|drive|fold|fm|cutoff|resonance|reso|feedback|chaos|strike)$/i.test(param.key)) {
      hot[param.key] = param.max;
    }
    if (/^(attack|decay|release|time)$/i.test(param.key)) {
      hot[param.key] = param.min;
    }
  }
  add("Hot Fast", hot);

  /* Every other sound-generator case renders at velocity 127, which makes any
   * velocity-depth parameter a no-op: `1 - depth * (1 - 1)` is 1 whatever the
   * depth is, so `Vel Depth Min` and `Vel Depth Max` came out byte-identical
   * to `Default` and the whole velocity path went unexercised. A soft hit at
   * full depth is where velocity scaling can actually misbehave. */
  if (kind === "sound_generator") {
    const velKeys = params.filter((param) => /^(vel|velocity)(_|$)/i.test(param.key));
    const soft = { ...defaults };
    for (const param of velKeys) soft[param.key] = param.max;
    add("Soft Hit", soft, false, 12);
    if (velKeys.length > 0) {
      const softHot = { ...hot };
      for (const param of velKeys) softHot[param.key] = param.max;
      add("Soft Hit Hot", softHot, false, 12);
    }
  }

  if (kind === "audio_fx") {
    add("Impulse Hot", hot);
  }

  return cases;
}

/* Params whose *maximum* is silence — a mute switch.
 *
 * Without this a module is failed by its own stress gate for behaving
 * correctly: lobber's `Mute Max` and `All Max` both reported "unexpectedly
 * silent", because only minima were ever considered silencing. */
function silencesAtMax(key: string): boolean {
  return /^(mute)$/i.test(key);
}

function isSilencingParam(param: Param, value: number, kind: string): boolean {
  if (value === param.max && silencesAtMax(param.key)) return true;
  if (value !== 0) return false;
  if (kind === "sound_generator") return /^(volume|level)$/i.test(param.key);
  return /^level$/i.test(param.key);
}

function hasSlowMaxAttack(params: Param[]): boolean {
  return params.some((param) => /attack/i.test(param.key) && param.max >= 1.5);
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
