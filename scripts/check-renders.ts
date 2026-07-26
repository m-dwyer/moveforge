import { readFile, readdir, writeFile, mkdir, copyFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { selectedModuleTargets, type ModuleBuildTarget } from "./lib/modules.ts";
import { metricsForWavFile, type WavMetrics } from "./wav-metrics.ts";
import { readWav, writeWav } from "./wav-io.ts";

type MetricValue = number | number[] | null;
type Tolerance = { floor: number; rel: number };
type RenderMetrics = Partial<Record<keyof WavMetrics, MetricValue>>;
type RenderMetricsByFile = Record<string, RenderMetrics>;

/* Tolerances are relative-first with a small absolute floor.
 *
 * The floor is `max(floor, rel * |golden|)`, so a metric's tolerance can never
 * be wider than the metric itself. The previous scheme checked a fixed `abs`
 * band first and short-circuited, which made any metric smaller than its own
 * tolerance a no-op — dustline's `02-air-noise` golden rms was 0.00029 against
 * an abs band of 0.01, so the check accepted everything from digital silence to
 * +7 dB, and that is how a NaN blowup stayed blessed for months.
 *
 * `floor` exists only to absorb cross-compiler last-ULP noise; it should always
 * be far below any musically meaningful change. */
const TOLERANCES: Partial<Record<keyof WavMetrics, Tolerance>> = {
  peak: { floor: 0.002, rel: 0.04 },
  rms: { floor: 0.0002, rel: 0.05 },
  dc_offset: { floor: 0.0005, rel: 0.25 },
  dc_offset_per_channel: { floor: 0.0005, rel: 0.25 },
  silence_ratio: { floor: 0.005, rel: 0.10 },
  stereo_correlation: { floor: 0.01, rel: 0.05 },
  zero_crossing_rate: { floor: 0.002, rel: 0.10 },
  clipped_samples: { floor: 4, rel: 0.10 },
  slew_ratio: { floor: 0.002, rel: 0.10 },
  /* Already dB relative to total, i.e. themselves relative measures, so the
   * tolerance is a flat dB band. 0.75 dB is below audibility for a single band
   * but well above cross-compiler noise. */
  band_energy: { floor: 0.75, rel: 0 },
  time_profile: { floor: 0.75, rel: 0 },
  /* Structural: these must match exactly. A truncated render, a wrong sample
   * rate, or a channel-count change is never within tolerance. Recorded in the
   * goldens all along, but never compared until now. */
  frames: { floor: 0, rel: 0 },
  sample_rate: { floor: 0, rel: 0 },
  channels: { floor: 0, rel: 0 }
};
const METRIC_FIELDS = Object.keys(TOLERANCES) as Array<keyof WavMetrics>;

/* Absolute sanity floors, checked without reference to any golden.
 *
 * A golden can be wrong. These cannot be blessed away, so they hold even when
 * the golden agrees with a broken render. Every one of these fails on
 * dustline's pre-fix `02-air-noise`. */
const SANITY = {
  minPeak: 0.02,
  minRms: 0.002,
  maxSilenceRatio: 0.99,
  maxAbsDc: 0.02
};

const args = process.argv.slice(2);
const mode = args.find((a) => !a.startsWith("-")) || "check";
const force = args.includes("--force");
if (!["check", "bless"].includes(mode)) {
  console.error("usage: pnpm run check-renders | pnpm run bless-renders [--force]");
  process.exit(2);
}

/* Any single metric moving more than this against an existing golden needs
 * --force, so a large intentional change is stated rather than assumed. */
const BLESS_REVIEW_REL = 0.2;

let failures = 0;
for (const target of await selectedModuleTargets()) {
  if (target.componentType === "sound_generator" || target.componentType === "audio_fx") {
    if (await checkWavSuite(target)) failures++;
  } else if (target.componentType === "midi_fx") {
    if (await checkTraceSuite(target)) failures++;
  } else {
    console.log(`[${target.id}] skipping (component_type='${target.componentType || "?"}' has no offline harness)`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} module(s) failed check. If the change is intentional: \`pnpm run bless-renders\`.`);
  process.exit(1);
}

async function checkWavSuite(target: ModuleBuildTarget): Promise<boolean> {
  const moduleId = target.id;
  const { goldenMetrics: goldenPath, suiteDir } = target.paths;
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

  const sparseFiles = await readSparseRenderFiles(target);
  const golden = await readMetrics(goldenPath).catch(() => null);

  /* Sanity floors are golden-independent, so they gate bless as well as check.
   * A render that is silent, non-finite, or DC-heavy is not blessable at all —
   * that is the difference between "this changed" and "this is broken". */
  const sanity: string[] = [];
  for (const file of wavs) {
    sanity.push(...sanityErrors(file, current[file], sparseFiles.has(file)));
  }

  if (mode === "bless") {
    if (sanity.length) {
      console.error(`[${moduleId}] refusing to bless — ${sanity.length} render(s) fail absolute sanity checks:`);
      for (const err of sanity) console.error(`  - ${err}`);
      console.error(`  These are not golden comparisons; the renders themselves are broken.`);
      return true;
    }

    const review = golden ? blessReview(golden, current) : [];
    if (review.length && !force) {
      console.error(`[${moduleId}] ${review.length} metric(s) move more than ${BLESS_REVIEW_REL * 100}%:`);
      for (const line of review) console.error(`  ${line}`);
      console.error(`\n  Listen to renders/${moduleId}-suite/ first. If this is intended:`);
      console.error(`    MODULE_ID=${moduleId} pnpm run bless-renders --force`);
      return true;
    }
    if (review.length) {
      console.log(`[${moduleId}] blessing ${review.length} large change(s) (--force):`);
      for (const line of review) console.log(`  ${line}`);
    }

    await mkdir(`goldens/${moduleId}`, { recursive: true });
    await writeFile(goldenPath, JSON.stringify(current, null, 2) + "\n");
    for (const file of wavs) {
      await copyFile(join(suiteDir, file), join(`goldens/${moduleId}`, file));
    }
    console.log(`[${moduleId}] blessed ${wavs.length} render(s) + WAV(s) → goldens/${moduleId}/`);
    return false;
  }

  if (!golden) {
    console.error(`[${moduleId}] missing ${goldenPath} — run \`pnpm run bless-renders\` to create it`);
    return true;
  }

  const moduleErrors = [...sanity];
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
        if (gv.length !== cv.length) {
          moduleErrors.push(`${file}.${field} length changed: golden=${gv.length} current=${cv.length}`);
          driftedFiles.add(file);
          continue;
        }
        for (let i = 0; i < gv.length; i++) {
          if (!within(gv[i], cv[i], tol)) {
            moduleErrors.push(`${file}.${field}[${i}] golden=${gv[i]} current=${cv[i]} (${bandFor(gv[i], tol)})`);
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
        moduleErrors.push(`${file}.${field} golden=${gv} current=${cv} (${bandFor(gv, tol)})`);
        driftedFiles.add(file);
      }
    }
  }

  if (moduleErrors.length) {
    console.error(`[${moduleId}] ${moduleErrors.length} drift(s):`);
    for (const err of moduleErrors) console.error(`  - ${err}`);
    if (driftedFiles.size > 0) await writeDiffArtifacts(target, [...driftedFiles].sort());
    return true;
  }
  console.log(`[${moduleId}] ${wavs.length} render(s) within tolerance of ${goldenPath}`);
  return false;
}

async function writeDiffArtifacts(target: ModuleBuildTarget, files: string[]): Promise<void> {
  const moduleId = target.id;
  const { suiteDir } = target.paths;
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

async function checkTraceSuite(target: ModuleBuildTarget): Promise<boolean> {
  const moduleId = target.id;
  const { suiteDir } = target.paths;
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
    return true;
  }
  console.log(`[${moduleId}] ${traces.length} trace(s) match goldens in ${goldenDir}/`);
  return false;
}

/* Relative-first with an absolute floor: the band is max(floor, rel * |golden|),
 * so a tolerance is never wider than the value it guards. */
function within(golden: number, current: number, tol: Tolerance): boolean {
  const diff = Math.abs(golden - current);
  const band = Math.max(tol.floor, tol.rel * Math.abs(golden));
  return diff <= band;
}

function bandFor(golden: number, tol: Tolerance): string {
  return `tol=${formatNum(Math.max(tol.floor, tol.rel * Math.abs(golden)))}`;
}

function formatNum(v: number): string {
  if (v === 0) return "0";
  if (Math.abs(v) < 1e-4) return v.toExponential(1);
  return String(Math.round(v * 1e6) / 1e6);
}

/* Golden-independent checks. `sparse` renders (a bare impulse into an FX, for
 * example) are legitimately mostly-silent, so only the silence floor is
 * relaxed for them — level and DC still have to hold. */
function sanityErrors(file: string, m: WavMetrics, sparse: boolean): string[] {
  const errs: string[] = [];
  if (m.peak < SANITY.minPeak) {
    errs.push(`${file}: peak ${m.peak} below floor ${SANITY.minPeak} — render is effectively silent`);
  }
  if (m.rms < SANITY.minRms) {
    errs.push(`${file}: rms ${m.rms} below floor ${SANITY.minRms} — render is effectively silent`);
  }
  if (!sparse && m.silence_ratio > SANITY.maxSilenceRatio) {
    errs.push(`${file}: silence_ratio ${m.silence_ratio} above ${SANITY.maxSilenceRatio} ` +
              `(add "sparse": true to this preset's render block if that is intended)`);
  }
  for (let c = 0; c < m.dc_offset_per_channel.length; c++) {
    const dc = m.dc_offset_per_channel[c];
    if (Math.abs(dc) > SANITY.maxAbsDc) {
      errs.push(`${file}: channel ${c} dc_offset ${dc} exceeds +-${SANITY.maxAbsDc}`);
    }
  }
  return errs;
}

async function readMetrics(path: string): Promise<RenderMetricsByFile> {
  return JSON.parse(await readFile(path, "utf8"));
}

/* Presets may mark their render `"sparse": true` when it is legitimately mostly
 * silence — a bare impulse fed to a delay, for example. That relaxes only the
 * silence floor, never the level or DC ones. */
async function readSparseRenderFiles(target: ModuleBuildTarget): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const doc = JSON.parse(await readFile(target.paths.presets, "utf8"));
    for (const preset of doc.presets ?? []) {
      if (preset?.render?.sparse && typeof preset.render.file === "string") {
        out.add(preset.render.file);
      }
    }
  } catch {
    /* No presets.json, or unreadable — validate covers that separately. */
  }
  return out;
}

/* Per-metric before/after for anything moving more than BLESS_REVIEW_REL.
 *
 * The point is that a bless states what it is accepting. dustline's silent
 * golden was re-blessed in a commit whose entire body was "Fix module stress
 * failures"; a 46 dB rms collapse should not be able to hide in that. */
function blessReview(golden: RenderMetricsByFile, current: Record<string, WavMetrics>): string[] {
  const lines: string[] = [];
  for (const file of Object.keys(current).sort()) {
    const g = golden[file];
    if (!g) {
      lines.push(`${file}: new render (no golden)`);
      continue;
    }
    for (const field of METRIC_FIELDS) {
      const gv = g[field];
      const cv = current[file][field] as MetricValue;
      if (typeof gv === "number" && typeof cv === "number") {
        if (bigMove(gv, cv)) lines.push(`${file}.${field}: ${gv} -> ${cv}${dbNote(field, gv, cv)}`);
      } else if (Array.isArray(gv) && Array.isArray(cv) && gv.length === cv.length) {
        for (let i = 0; i < gv.length; i++) {
          if (bigMove(gv[i], cv[i])) lines.push(`${file}.${field}[${i}]: ${gv[i]} -> ${cv[i]}`);
        }
      }
    }
  }
  return lines;
}

function bigMove(g: number, c: number): boolean {
  const tol = Math.max(1e-6, BLESS_REVIEW_REL * Math.abs(g));
  return Math.abs(g - c) > tol;
}

/* Level metrics are much easier to judge in dB than as raw ratios. */
function dbNote(field: string, g: number, c: number): string {
  if (field !== "peak" && field !== "rms") return "";
  if (g <= 0 || c <= 0) return "";
  const db = 20 * Math.log10(c / g);
  return `  (${db >= 0 ? "+" : ""}${db.toFixed(1)} dB)`;
}
