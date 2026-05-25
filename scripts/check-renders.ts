import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { modulePaths, selectedModuleIds } from "./lib/modules.ts";
import { metricsForWavFile, type WavMetrics } from "./wav-metrics.ts";

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
  if (!(await hasAudioRenderPath(moduleId))) {
    console.log(`[${moduleId}] skipping render check (no offline render path for this component_type)`);
    continue;
  }
  const { goldenMetrics: goldenPath, suiteDir } = modulePaths(moduleId);

  const wavs = (await readdir(suiteDir, { withFileTypes: true }).catch(() => []))
    .filter((e) => e.isFile() && e.name.endsWith(".wav"))
    .map((e) => e.name)
    .sort();

  if (wavs.length === 0) {
    console.error(`[${moduleId}] no WAVs in ${suiteDir} — run scripts/render-demo.sh --suite first`);
    failures++;
    continue;
  }

  const current: Record<string, WavMetrics> = {};
  for (const file of wavs) {
    current[file] = await metricsForWavFile(join(suiteDir, file));
  }

  if (mode === "bless") {
    await mkdir(`goldens/${moduleId}`, { recursive: true });
    await writeFile(goldenPath, JSON.stringify(current, null, 2) + "\n");
    console.log(`[${moduleId}] blessed ${wavs.length} render(s) → ${goldenPath}`);
    continue;
  }

  const golden = await readJson(goldenPath).catch(() => null);
  if (!golden) {
    console.error(`[${moduleId}] missing ${goldenPath} — run \`pnpm run bless-renders\` to create it`);
    failures++;
    continue;
  }

  const moduleErrors = [];
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
          }
        }
      } else if (gv == null && cv == null) {
        continue;
      } else if (gv == null || cv == null) {
        moduleErrors.push(`${file}.${field} nullness changed: golden=${gv} current=${cv}`);
      } else if (Array.isArray(gv) || Array.isArray(cv)) {
        moduleErrors.push(`${file}.${field} shape changed: golden=${JSON.stringify(gv)} current=${JSON.stringify(cv)}`);
      } else if (!within(gv, cv, tol)) {
        moduleErrors.push(`${file}.${field} golden=${gv} current=${cv} (abs=${tol.abs}, rel=${tol.rel})`);
      }
    }
  }

  if (moduleErrors.length) {
    console.error(`[${moduleId}] ${moduleErrors.length} drift(s):`);
    for (const err of moduleErrors) console.error(`  - ${err}`);
    failures++;
  } else {
    console.log(`[${moduleId}] ${wavs.length} render(s) within tolerance of ${goldenPath}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} module(s) failed render check. If the change is intentional: \`pnpm run bless-renders\`.`);
  process.exit(1);
}

function within(golden: number, current: number, tol: Tolerance): boolean {
  const diff = Math.abs(golden - current);
  if (diff <= tol.abs) return true;
  if (Math.abs(golden) > 0 && diff / Math.abs(golden) <= tol.rel) return true;
  return false;
}

async function readJson(path: string): Promise<RenderMetricsByFile> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function hasAudioRenderPath(moduleId: string): Promise<boolean> {
  const { moduleJson } = modulePaths(moduleId);
  try {
    const json = JSON.parse(await readFile(moduleJson, "utf8")) as { capabilities?: { component_type?: string } };
    return json.capabilities?.component_type === "sound_generator";
  } catch {
    return false;
  }
}
