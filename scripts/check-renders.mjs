import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { metricsForWavFile } from "./wav-metrics.mjs";

const TOLERANCES = {
  peak: { abs: 0.02, rel: 0.04 },
  rms: { abs: 0.01, rel: 0.05 },
  dc_offset: { abs: 0.005, rel: Infinity },
  silence_ratio: { abs: 0.05, rel: Infinity },
  stereo_correlation: { abs: 0.05, rel: Infinity },
  zero_crossing_rate: { abs: 0.01, rel: 0.10 },
  clipped_samples: { abs: 16, rel: Infinity }
};

const mode = process.argv[2] || "check";
if (!["check", "bless"].includes(mode)) {
  console.error("usage: node scripts/check-renders.mjs [check|bless]");
  process.exit(2);
}

const moduleIds = process.env.MODULE_ID
  ? [process.env.MODULE_ID]
  : (await readdir("src/modules", { withFileTypes: true }))
      .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
      .map((e) => e.name)
      .sort();

let failures = 0;
for (const moduleId of moduleIds) {
  const suiteDir = `renders/${moduleId}-suite`;
  const goldenPath = `goldens/${moduleId}/metrics.json`;

  const wavs = (await readdir(suiteDir, { withFileTypes: true }).catch(() => []))
    .filter((e) => e.isFile() && e.name.endsWith(".wav"))
    .map((e) => e.name)
    .sort();

  if (wavs.length === 0) {
    console.error(`[${moduleId}] no WAVs in ${suiteDir} — run scripts/render-demo.sh --suite first`);
    failures++;
    continue;
  }

  const current = {};
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
    console.error(`[${moduleId}] missing ${goldenPath} — run \`node scripts/check-renders.mjs bless\` to create it`);
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
    for (const [field, tol] of Object.entries(TOLERANCES)) {
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
  console.error(`\n${failures} module(s) failed render check. If the change is intentional: \`node scripts/check-renders.mjs bless\`.`);
  process.exit(1);
}

function within(golden, current, tol) {
  const diff = Math.abs(golden - current);
  if (diff <= tol.abs) return true;
  if (Math.abs(golden) > 0 && diff / Math.abs(golden) <= tol.rel) return true;
  return false;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
