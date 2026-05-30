import { readFile, readdir, writeFile, mkdir, copyFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { modulePaths, readModuleTarget, selectedModuleIds } from "./lib/modules.ts";
import { metricsForWavFile, type WavMetrics } from "./wav-metrics.ts";
import { readWav, writeWav } from "./wav-io.ts";

type MetricValue = number | number[] | null;
type Tolerance = { abs: number; rel: number };
type RenderMetrics = Partial<Record<keyof WavMetrics, MetricValue>>;
type RenderMetricsByFile = Record<string, RenderMetrics>;

const TOLERANCES: Partial<Record<keyof WavMetrics, Tolerance>> = {
  peak: { abs: 0.02, rel: 0.04 },
  rms: { abs: 0.01, rel: 0.05 },
  dc_offset: { abs: 0.005, rel: Infinity },
  silence_ratio: { abs: 0.05, rel: Infinity },
  stereo_correlation: { abs: 0.05, rel: Infinity },
  zero_crossing_rate: { abs: 0.01, rel: 0.10 },
  clipped_samples: { abs: 16, rel: Infinity }
};
const METRIC_FIELDS = Object.keys(TOLERANCES) as Array<keyof WavMetrics>;

const mode = process.argv[2] || "check";
if (!["check", "bless"].includes(mode)) {
  console.error("usage: pnpm run check-renders | pnpm run bless-renders");
  process.exit(2);
}

const moduleIds = await selectedModuleIds();

let failures = 0;
for (const moduleId of moduleIds) {
  const kind = await componentTypeFor(moduleId);
  if (kind === "sound_generator" || kind === "audio_fx") {
    if (await checkWavSuite(moduleId)) failures++;
  } else if (kind === "midi_fx") {
    if (await checkTraceSuite(moduleId)) failures++;
  } else {
    console.log(`[${moduleId}] skipping (component_type='${kind ?? "?"}' has no offline harness)`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} module(s) failed check. If the change is intentional: \`pnpm run bless-renders\`.`);
  process.exit(1);
}

async function checkWavSuite(moduleId: string): Promise<boolean> {
  const { goldenMetrics: goldenPath, suiteDir } = modulePaths(moduleId);
  const wavs = (await readdir(suiteDir, { withFileTypes: true }).catch(() => []))
    .filter((e) => e.isFile() && e.name.endsWith(".wav") && !e.name.endsWith(".diff.wav"))
    .map((e) => e.name)
    .sort();

  if (wavs.length === 0) {
    console.error(`[${moduleId}] no WAVs in ${suiteDir} — run scripts/render-demo.sh --suite first`);
    return true;
  }

  const current: Record<string, WavMetrics> = {};
  for (const file of wavs) {
    current[file] = await metricsForWavFile(join(suiteDir, file));
  }

  if (mode === "bless") {
    await mkdir(`goldens/${moduleId}`, { recursive: true });
    await writeFile(goldenPath, JSON.stringify(current, null, 2) + "\n");
    for (const file of wavs) {
      await copyFile(join(suiteDir, file), join(`goldens/${moduleId}`, file));
    }
    console.log(`[${moduleId}] blessed ${wavs.length} render(s) + WAV(s) → goldens/${moduleId}/`);
    return false;
  }

  const golden = await readMetrics(goldenPath).catch(() => null);
  if (!golden) {
    console.error(`[${moduleId}] missing ${goldenPath} — run \`pnpm run bless-renders\` to create it`);
    return true;
  }

  const moduleErrors = [];
  const driftedFiles = new Set<string>();
  const goldenFiles = new Set(Object.keys(golden));
  const currentFiles = new Set(Object.keys(current));
  for (const file of goldenFiles) if (!currentFiles.has(file)) moduleErrors.push(`missing render ${file}`);
  for (const file of currentFiles) if (!goldenFiles.has(file)) moduleErrors.push(`unexpected render ${file} (re-bless if intentional)`);

  for (const file of [...currentFiles].sort()) {
    const g = golden[file];
    const c = current[file];
    if (!g) continue;
    for (const field of METRIC_FIELDS) {
      const tol = TOLERANCES[field];
      if (!tol) continue;
      const gv = g[field];
      const cv = c[field];
      if (Array.isArray(gv) && Array.isArray(cv)) {
        for (let i = 0; i < gv.length; i++) {
          if (!within(gv[i], cv[i], tol)) {
            moduleErrors.push(`${file}.${field}[${i}] golden=${gv[i]} current=${cv[i]} (abs=${tol.abs}, rel=${tol.rel})`);
            driftedFiles.add(file);
          }
        }
      } else if (gv == null && cv == null) {
        continue;
      } else if (gv == null || cv == null) {
        moduleErrors.push(`${file}.${field} nullness changed: golden=${gv} current=${cv}`);
        driftedFiles.add(file);
      } else if (Array.isArray(gv) || Array.isArray(cv)) {
        moduleErrors.push(`${file}.${field} shape changed: golden=${JSON.stringify(gv)} current=${JSON.stringify(cv)}`);
        driftedFiles.add(file);
      } else if (!within(gv, cv, tol)) {
        moduleErrors.push(`${file}.${field} golden=${gv} current=${cv} (abs=${tol.abs}, rel=${tol.rel})`);
        driftedFiles.add(file);
      }
    }
  }

  if (moduleErrors.length) {
    console.error(`[${moduleId}] ${moduleErrors.length} drift(s):`);
    for (const err of moduleErrors) console.error(`  - ${err}`);
    if (driftedFiles.size > 0) await writeDiffArtifacts(moduleId, [...driftedFiles].sort());
    return true;
  }
  console.log(`[${moduleId}] ${wavs.length} render(s) within tolerance of ${goldenPath}`);
  return false;
}

async function writeDiffArtifacts(moduleId: string, files: string[]): Promise<void> {
  const { suiteDir } = modulePaths(moduleId);
  const goldenDir = `goldens/${moduleId}`;
  const plotDir = `renders/plots/${moduleId}`;
  await mkdir(plotDir, { recursive: true });

  const wrote: string[] = [];
  for (const file of files) {
    const goldenWav = join(goldenDir, file);
    const currentWav = join(suiteDir, file);
    try {
      await readFile(goldenWav);
    } catch {
      console.error(`  (no golden WAV at ${goldenWav} — re-bless to capture audio for future diffs)`);
      continue;
    }

    const golden = await readWav(goldenWav);
    const current = await readWav(currentWav);
    const n = Math.min(golden.samples.length, current.samples.length);
    const diffSamples = new Float32Array(n);
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const d = current.samples[i] - golden.samples[i];
      diffSamples[i] = d;
      const a = Math.abs(d);
      if (a > peak) peak = a;
    }
    const norm = peak > 0 ? Math.min(1, 1 / peak) : 1;
    const normalized = new Float32Array(n);
    for (let i = 0; i < n; i++) normalized[i] = diffSamples[i] * norm;

    const diffWavPath = join(suiteDir, `${stem(file)}.diff.wav`);
    await writeWav(diffWavPath, {
      channels: current.channels,
      frames: Math.floor(n / current.channels),
      sampleRate: current.sampleRate,
      samples: normalized
    });
    wrote.push(`${diffWavPath} (peak=${peak.toExponential(2)}, ×${(1 / Math.max(norm, 1e-12)).toFixed(1)} normalized)`);

    const plotPath = join(plotDir, `${stem(file)}.diff.png`);
    const py = spawnSync(".venv/bin/python", [
      "tools/render_diff.py",
      "--golden", goldenWav,
      "--current", currentWav,
      "--out", plotPath,
      "--label", `${moduleId} / ${file}`
    ], { stdio: "ignore" });
    if (py.status === 0) wrote.push(plotPath);
  }
  if (wrote.length) {
    console.error(`  diff artifacts:`);
    for (const w of wrote) console.error(`    ${w}`);
  }
}

function stem(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? name : name.slice(0, i);
}

async function checkTraceSuite(moduleId: string): Promise<boolean> {
  const { suiteDir, moduleDir } = modulePaths(moduleId);
  const traces = (await readdir(suiteDir, { withFileTypes: true }).catch(() => []))
    .filter((e) => e.isFile() && e.name.endsWith(".trace"))
    .map((e) => e.name)
    .sort();

  if (traces.length === 0) {
    console.error(`[${moduleId}] no .trace files in ${suiteDir} — run scripts/render-demo.sh --suite first`);
    return true;
  }

  const goldenDir = `goldens/${moduleId}`;

  if (mode === "bless") {
    await mkdir(goldenDir, { recursive: true });
    for (const file of traces) {
      const text = await readFile(join(suiteDir, file), "utf8");
      await writeFile(join(goldenDir, file), text);
    }
    console.log(`[${moduleId}] blessed ${traces.length} trace(s) → ${goldenDir}/`);
    return false;
  }

  const goldenFiles = new Set(
    (await readdir(goldenDir, { withFileTypes: true }).catch(() => []))
      .filter((e) => e.isFile() && e.name.endsWith(".trace"))
      .map((e) => e.name)
  );
  const currentFiles = new Set(traces);

  const moduleErrors: string[] = [];
  for (const file of goldenFiles) if (!currentFiles.has(file)) moduleErrors.push(`missing trace ${file}`);
  for (const file of currentFiles) if (!goldenFiles.has(file)) moduleErrors.push(`unexpected trace ${file} (re-bless if intentional)`);

  for (const file of [...currentFiles].sort()) {
    if (!goldenFiles.has(file)) continue;
    const goldenText = await readFile(join(goldenDir, file), "utf8");
    const currentText = await readFile(join(suiteDir, file), "utf8");
    if (goldenText !== currentText) {
      moduleErrors.push(`${file} differs from golden`);
    }
  }

  if (moduleErrors.length) {
    console.error(`[${moduleId}] ${moduleErrors.length} trace drift(s):`);
    for (const err of moduleErrors) console.error(`  - ${err}`);
    void moduleDir;
    return true;
  }
  console.log(`[${moduleId}] ${traces.length} trace(s) match goldens in ${goldenDir}/`);
  return false;
}

function within(golden: number, current: number, tol: Tolerance): boolean {
  const diff = Math.abs(golden - current);
  if (diff <= tol.abs) return true;
  if (Math.abs(golden) > 0 && diff / Math.abs(golden) <= tol.rel) return true;
  return false;
}

async function readMetrics(path: string): Promise<RenderMetricsByFile> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function componentTypeFor(moduleId: string): Promise<string | null> {
  try {
    return (await readModuleTarget(moduleId)).componentType || null;
  } catch {
    return null;
  }
}
