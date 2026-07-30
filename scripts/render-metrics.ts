import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { selectedModuleTargets } from "./lib/modules.ts";
import { metricsForWavFile, type WavMetrics } from "./wav-metrics.ts";

for (const target of await selectedModuleTargets()) {
  const moduleId = target.id;
  const { suiteDir } = target.paths;

  const entries = await readdir(suiteDir, { withFileTypes: true }).catch(() => []);
  const wavs = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".wav")).map((entry) => entry.name);
  if (wavs.length === 0) {
    console.error(`[${moduleId}] no WAV files in ${suiteDir} — run 'mise run suite' first`);
    process.exit(1);
  }

  const summary: Record<string, WavMetrics> = {};
  for (const file of wavs.sort()) {
    const path = join(suiteDir, file);
    const metrics = await metricsForWavFile(path);
    summary[file] = metrics;
    console.log(`[${moduleId}] ${file}: peak=${metrics.peak} rms=${metrics.rms} zcrL=${metrics.zero_crossing_rate[0]} dc=${metrics.dc_offset}`);
  }

  const outPath = join(suiteDir, "metrics.json");
  await writeFile(outPath, JSON.stringify(summary, null, 2) + "\n");
  console.log(`wrote ${outPath}`);
}
