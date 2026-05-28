import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { modulePaths, selectedModuleIds } from "./lib/modules.ts";
import { metricsForWavFile } from "./wav-metrics.ts";
import { readWav } from "./wav-io.ts";

type StressCase = {
  file: string;
  label: string;
  expect_silence?: boolean;
};

type StressManifest = {
  module_id: string;
  component_type: string;
  cases: StressCase[];
};

let failures = 0;
for (const moduleId of await selectedModuleIds()) {
  if (await checkModule(moduleId)) failures++;
}

if (failures > 0) {
  console.error(`\n${failures} module(s) failed stress checks.`);
  process.exit(1);
}

async function checkModule(moduleId: string): Promise<boolean> {
  const paths = modulePaths(moduleId);
  const moduleJson = JSON.parse(await readFile(paths.moduleJson, "utf8"));
  const kind = moduleJson.capabilities?.component_type ?? "";
  if (kind !== "sound_generator" && kind !== "audio_fx") {
    console.log(`[${moduleId}] skipping stress check: component_type='${kind}'`);
    return false;
  }

  const manifestPath = join(paths.stressDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8").catch(() => {
    throw new Error(`[${moduleId}] missing ${manifestPath} — run stress renders first`);
  })) as StressManifest;
  const files = new Set((await readdir(paths.stressDir)).filter((name) => name.endsWith(".wav")));
  const errors: string[] = [];

  for (const stressCase of manifest.cases) {
    if (!files.has(stressCase.file)) {
      errors.push(`${stressCase.file}: missing stress render`);
      continue;
    }

    const wavPath = join(paths.stressDir, stressCase.file);
    const metrics = await metricsForWavFile(wavPath);
    if (metrics.clipped_samples > 0) errors.push(`${stressCase.file}: ${metrics.clipped_samples} clipped sample(s)`);
    if (Math.abs(metrics.dc_offset) > 0.05) errors.push(`${stressCase.file}: dc_offset=${metrics.dc_offset}`);
    if (metrics.peak > 0.995) errors.push(`${stressCase.file}: peak=${metrics.peak} leaves too little headroom`);
    if (!stressCase.expect_silence && metrics.peak < 0.005) errors.push(`${stressCase.file}: unexpectedly silent`);
    if (!stressCase.expect_silence && metrics.rms < 0.0005) errors.push(`${stressCase.file}: unexpectedly low RMS=${metrics.rms}`);

    if (!stressCase.expect_silence && metrics.peak >= 0.005) {
      const imbalance = await stereoImbalance(wavPath);
      if (imbalance > 6.0) errors.push(`${stressCase.file}: stereo imbalance=${imbalance.toFixed(2)}x`);
    }
  }

  if (errors.length > 0) {
    console.error(`[${moduleId}] ${errors.length} stress failure(s):`);
    for (const error of errors) console.error(`  - ${error}`);
    return true;
  }

  console.log(`[${moduleId}] ${manifest.cases.length} stress render(s) passed metric gates`);
  return false;
}

async function stereoImbalance(path: string): Promise<number> {
  const wav = await readWav(path);
  if (wav.channels !== 2) return 1.0;
  let sumL = 0;
  let sumR = 0;
  for (let i = 0; i < wav.frames; i++) {
    const l = wav.samples[i * 2];
    const r = wav.samples[i * 2 + 1];
    sumL += l * l;
    sumR += r * r;
  }
  const rmsL = Math.sqrt(sumL / Math.max(1, wav.frames));
  const rmsR = Math.sqrt(sumR / Math.max(1, wav.frames));
  const hi = Math.max(rmsL, rmsR);
  const lo = Math.max(1e-9, Math.min(rmsL, rmsR));
  return hi / lo;
}
