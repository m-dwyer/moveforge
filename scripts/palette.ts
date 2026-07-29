import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { describe, fingerprint, spreadOf, type Descriptors } from "./lib/descriptors.ts";
import { selectedModuleTargets } from "./lib/modules.ts";
import { densePresetValues, type PresetParam } from "../shared/presets.ts";
import { paramGroups, type UiHierarchy } from "../shared/ui-hierarchy.ts";
import { readWav } from "./wav-io.ts";

/* Audition a module: what does every voice, every knob and every preset sound
 * like?
 *
 * The suite and stress harnesses both answer "did this change" — they compare
 * against a golden or against a safety threshold, and neither can tell you what
 * the module *sounds* like or whether a control does anything at all. That gap
 * is expensive: four separate controls in swarf were measured lying about their
 * own behaviour (a `decay` short by an octave, a `strike` that silently
 * outranked it, a `tone` transparent at its default, a wash inaudible at its),
 * and every one of them shipped green through both harnesses.
 *
 * Three sections, and the knob sweep is the one that catches that class:
 *
 *   note map   one hit per note from `root` up, so a note-mapped drum module's
 *              voices can be auditioned apart instead of guessed at from a grid
 *   sweeps     every parameter min -> max, reporting how far the sound actually
 *              travels, and flagging the ones where it does not travel at all
 *   presets    the same fingerprint per preset, so "these presets make no
 *              sense" becomes a table rather than an impression
 *
 * Two outputs from one run. `palette.md` is compact fixed-width tables meant to
 * be read whole by a person or a model. `palette.html` is self-contained: every
 * row carries its own audio and an inline SVG of its spectrum, because the
 * thing that was actually missing was a way to *hear* these in an order that
 * makes sense rather than by hitting Randomize.
 */

const STEPS = 5;             /* points per parameter sweep */
/* Sweeps are short on purpose. A module with sixty-two parameters renders three
 * hundred of them, and at the note map's length that is 190 MB of WAV for a
 * report someone runs on every DSP change. Long enough to hear the character
 * and to measure a tail up to ~1 s; the note map and presets get the full
 * length because those are the ones anyone actually listens through. */
const SWEEP_SECONDS = 1.5;
const AUDITION_SECONDS = 3;
const NOTE_SPAN = 12;        /* notes probed above `root` */

type ParamDef = {
  key: string;
  name?: string;
  min: number;
  max: number;
  default: number;
  step?: number;
  type?: string;
};

type Row = {
  id: string;
  label: string;
  group: string;
  note: number;
  file: string;
  d: Descriptors;
};

type ModuleJson = {
  capabilities?: { component_type?: string; ui_hierarchy?: UiHierarchy<ParamDef> };
  name?: string;
};

function fmtHz(hz: number): string {
  if (!Number.isFinite(hz) || hz <= 0) return "-";
  return hz >= 1000 ? `${(hz / 1000).toFixed(1)}k` : `${Math.round(hz)}`;
}

function fmtMs(ms: number | null): string {
  if (ms === null) return ">render";
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
}

function fmtDb(db: number): string {
  return Number.isFinite(db) ? db.toFixed(1) : "-inf";
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

function padL(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : " ".repeat(n - s.length) + s;
}

async function main(): Promise<void> {
  const targets = await selectedModuleTargets();
  for (const target of targets) {
    if (target.componentType !== "sound_generator") {
      console.log(`[${target.id}] palette covers sound generators only — skipped`);
      continue;
    }
    await paletteFor(target.id, target.renderBin);
  }
}

async function paletteFor(moduleId: string, renderBin: string): Promise<void> {
  const dir = `renders/palette/${moduleId}`;
  await mkdir(dir, { recursive: true });

  const moduleJson = JSON.parse(
    await readFile(`src/modules/${moduleId}/module.json`, "utf8")
  ) as ModuleJson;
  const presetsJson = JSON.parse(
    await readFile(`src/modules/${moduleId}/presets.json`, "utf8")
  ) as { presets?: Array<{ name: string; params?: Record<string, number> }> };

  /* Through paramGroups, never by re-reading `levels`: parameter order is an ABI
   * and shared/ui-hierarchy.ts is the only walk of it in the tree. */
  const groups = paramGroups<ParamDef>(moduleJson.capabilities?.ui_hierarchy);
  const params = groups.flatMap((g) =>
    g.params.map((p) => ({ ...p, group: g.label ?? g.group }))
  );
  const defaults = new Map(params.map((p) => [p.key, p.default]));

  /* A note-mapped module puts its voices on consecutive notes from `root`. When
   * there is no `root` the module is melodic, so probing a range of notes says
   * nothing and one note at the default is the right audition. */
  const rootParam = params.find((p) => p.key === "root");
  const rootNote = rootParam ? Math.round(rootParam.default) : 60;
  const noteCount = rootParam ? NOTE_SPAN : 1;

  const render = (file: string, note: number, overrides: Record<string, number>,
                  seconds = SWEEP_SECONDS): void => {
    const args = [
      "--render", `${dir}/${file}`, String(Math.ceil(seconds)), "8", "4", "110",
      `${note},,,,,,,,,,,,,,,`
    ];
    for (const p of params) {
      const v = overrides[p.key] ?? defaults.get(p.key) ?? p.default;
      args.push(`${p.key}=${v}`);
    }
    const r = spawnSync(renderBin, args, { stdio: ["ignore", "ignore", "inherit"] });
    if (r.status !== 0) throw new Error(`${renderBin} failed on ${file}`);
  };

  const analyse = async (file: string): Promise<Descriptors> => {
    const wav = await readWav(`${dir}/${file}`);
    const frames = wav.samples.length / wav.channels;
    const mono = new Float64Array(frames);
    for (let i = 0; i < frames; i++) {
      let sum = 0;
      for (let c = 0; c < wav.channels; c++) sum += wav.samples[i * wav.channels + c];
      mono[i] = sum / wav.channels;
    }
    const side = new Float64Array(frames);
    if (wav.channels === 2) {
      for (let i = 0; i < frames; i++) {
        side[i] = (wav.samples[i * 2] - wav.samples[i * 2 + 1]) / 2;
      }
    }
    return describe(mono, wav.sampleRate, side);
  };

  /* ---- 1. note map ---- */
  const notes: Row[] = [];
  for (let i = 0; i < noteCount; i++) {
    const note = rootNote + i;
    const file = `note-${String(note).padStart(3, "0")}.wav`;
    render(file, note, {}, AUDITION_SECONDS);
    notes.push({
      id: `note-${note}`, label: `note ${note}`, group: "note map",
      note, file, d: await analyse(file)
    });
  }
  /* Only notes that actually sounded. A module's levels do not all carry voices
   * — swarf's Kit and Map are groups 7 and 8 and there is no note 42 — and
   * sweeping a global control on a silent note reports every one of them dead.
   * That happened on the first run: 13 of 17 "dead" knobs were this bug. */
  const sounding = notes.filter((r) => !r.d.silent).map((r) => r.note);
  const fallbackNote = sounding[0] ?? rootNote;
  const voiceNote = (index: number) =>
    index < sounding.length ? sounding[index] : fallbackNote;

  /* ---- 2. knob sweeps ---- */
  type Sweep = { param: ParamDef & { group: string }; rows: Row[] };
  const sweeps: Sweep[] = [];
  for (const p of params) {
    /* Sweep each parameter on the voice it belongs to. A per-voice `decay`
     * swept while listening to a different voice reads as a dead knob, which is
     * exactly the false alarm this report must not produce. */
    const groupIndex = groups.findIndex((g) => (g.label ?? g.group) === p.group);
    const note = voiceNote(groupIndex < 0 ? 0 : groupIndex);
    const rows: Row[] = [];
    for (let s = 0; s < STEPS; s++) {
      const t = s / (STEPS - 1);
      let value = p.min + (p.max - p.min) * t;
      if (p.type === "int" || p.step === 1) value = Math.round(value);
      const file = `sweep-${p.key}-${s}.wav`;
      render(file, note, { [p.key]: value });
      rows.push({
        id: `${p.key}-${s}`, label: `${p.key}=${round(value)}`,
        group: p.group, note, file, d: await analyse(file)
      });
    }
    sweeps.push({ param: p, rows });
  }

  /* ---- 3. presets ---- */
  const presetRows: Row[] = [];
  for (const [i, preset] of (presetsJson.presets ?? []).entries()) {
    const dense = Object.fromEntries(
      densePresetValues(params as unknown as PresetParam[], preset.params ?? {}, preset.name)
        .map((r) => [r.key, r.value])
    );
    const file = `preset-${String(i).padStart(2, "0")}.wav`;
    /* Presets are whole-kit settings, so they are auditioned on the first voice
     * — the sweep section is where per-voice detail lives. */
    render(file, rootNote, dense, AUDITION_SECONDS);
    presetRows.push({
      id: `preset-${i}`, label: preset.name, group: "presets",
      note: rootNote, file, d: await analyse(file)
    });
  }

  const md = renderMarkdown(moduleId, moduleJson, notes, sweeps, presetRows, rootParam != null);
  await writeFile(`${dir}/palette.md`, md);
  const html = await renderHtml(moduleId, moduleJson, dir, notes, sweeps, presetRows);
  await writeFile(`${dir}/palette.html`, html);

  const dead = sweeps.filter((s) => isDead(s)).length;
  console.log(`[${moduleId}] palette: ${notes.length} notes, ${sweeps.length} sweeps ` +
              `(${dead} with no audible travel), ${presetRows.length} presets`);
  console.log(`[${moduleId}] ${dir}/palette.html  ${dir}/palette.md`);
}

function round(v: number): number {
  return Math.abs(v - Math.round(v)) < 1e-6 ? Math.round(v) : Number(v.toFixed(3));
}

/* Controls a one-note, one-hit sweep structurally cannot judge. They are
 * reported apart rather than as dead, because calling them dead would be a
 * false alarm and dropping them would hide that they are untested.
 *
 *   root, chrom   change which note maps to which voice, so the fixed note this
 *                 harness plays lands somewhere else entirely
 *   choke         is a relationship between two voices and needs two hits
 *   human         is per-hit variation; one hit cannot differ from itself */
const NEEDS_A_PATTERN = new Set(["root", "chrom", "choke", "human"]);

/* A knob counts as dead when nothing a listener could name moved: less than a
 * third of an octave of centroid, a 40% change in length, 0.08 of flatness,
 * 1.5 dB of level and 0.05 of stereo width, across its entire declared range.
 * Generous on purpose — a false "dead" is worse than a missed one, because it
 * sends someone hunting for a bug that is not there. */
function travel(rows: Row[]) {
  return {
    centroid: spreadOf(rows.map((r) => r.d.centroidHz), "ratio"),
    length: spreadOf(rows.map((r) => (r.d.t60Ms ?? 8000)), "ratio"),
    flatness: spreadOf(rows.map((r) => r.d.flatness), "linear"),
    level: spreadOf(rows.map((r) => r.d.peakDb), "linear"),
    width: spreadOf(rows.map((r) => r.d.width), "linear"),
    bright: spreadOf(rows.map((r) => r.d.bright), "linear")
  };
}

function isDead(s: { param: { key: string }; rows: Row[] }): boolean {
  if (NEEDS_A_PATTERN.has(s.param.key)) return false;
  const t = travel(s.rows);
  return t.centroid < 0.33 && t.length < 0.5 && t.flatness < 0.08
    && t.level < 1.5 && t.width < 0.05 && t.bright < 0.10;
}

function rowLine(label: string, d: Descriptors): string {
  return `${pad(label, 22)} ${padL(fmtDb(d.peakDb), 7)} ${padL(fmtMs(d.t60Ms), 8)} ` +
    `${padL(fmtHz(d.centroidHz), 8)} ${padL((d.bright * 100).toFixed(0) + "%", 7)} ` +
    `${padL(d.flatness.toFixed(2), 6)} ${padL(d.crestDb.toFixed(0), 6)}  ${fingerprint(d)}`;
}

const HEADER = `${pad("", 22)} ${padL("peak", 7)} ${padL("T60", 8)} ${padL("centroid", 8)} ` +
  `${padL("bright", 7)} ${padL("flat", 6)} ${padL("crest", 6)}  reads as`;

function renderMarkdown(
  moduleId: string,
  moduleJson: ModuleJson,
  notes: Row[],
  sweeps: Array<{ param: ParamDef & { group: string }; rows: Row[] }>,
  presets: Row[],
  noteMapped: boolean
): string {
  const out: string[] = [];
  out.push(`# ${moduleJson.name ?? moduleId} — sonic palette`);
  out.push("");
  out.push("peak dBFS · T60 to -60 dB · centroid Hz · bright = energy above 4 kHz ·");
  out.push("flat = spectral flatness 2-14 kHz (1 white, 0 a few tones) · crest = peak/RMS dB");
  out.push("");

  out.push(noteMapped ? "## Note map" : "## Default voice");
  out.push("");
  out.push("```");
  out.push(HEADER);
  for (const r of notes) out.push(rowLine(r.label, r.d));
  out.push("```");
  out.push("");

  const dead = sweeps.filter(isDead);
  out.push("## Knob travel");
  out.push("");
  out.push("How far each control moves the sound across its whole declared range.");
  out.push("Centroid and length in octaves/doublings, flatness absolute, level in dB.");
  out.push("");
  if (dead.length > 0) {
    out.push(`**${dead.length} of ${sweeps.length} controls move nothing audible:** ` +
      dead.map((s) => `\`${s.param.key}\``).join(", "));
    out.push("");
  }
  out.push("```");
  out.push(`${pad("", 22)} ${padL("centroid", 9)} ${padL("length", 8)} ${padL("flat", 7)} ${padL("level", 7)} ${padL("width", 7)} ${padL("bright", 7)}`);
  let lastGroup = "";
  for (const s of sweeps) {
    if (s.param.group !== lastGroup) { out.push(`-- ${s.param.group}`); lastGroup = s.param.group; }
    const t = travel(s.rows);
    const flag = isDead(s) ? "  DEAD"
      : NEEDS_A_PATTERN.has(s.param.key) ? "  (needs a pattern)" : "";
    out.push(`${pad(s.param.key, 22)} ${padL(t.centroid.toFixed(2) + " oct", 9)} ` +
      `${padL(t.length.toFixed(2) + "x", 8)} ${padL(t.flatness.toFixed(2), 7)} ` +
      `${padL(t.level.toFixed(1) + " dB", 7)} ${padL(t.width.toFixed(2), 7)} ` +
      `${padL(t.bright.toFixed(2), 7)}${flag}`);
  }
  out.push("```");
  out.push("");

  if (presets.length > 0) {
    out.push("## Presets");
    out.push("");
    out.push("```");
    out.push(HEADER);
    for (const r of presets) out.push(rowLine(r.label, r.d));
    out.push("```");
    out.push("");
  }
  return out.join("\n");
}

/* Inline SVG rather than a PNG: no encoder, no dependency, and it scales and
 * diffs. One 96-band log-frequency spectrum per row is enough to see the shape
 * beside the audio without turning the page into a signal analyser. */
function spectrumSvg(d: Descriptors, bands: number[]): string {
  const w = 180, h = 34;
  const bars = bands.map((v, i) => {
    const x = (i / bands.length) * w;
    const bw = w / bands.length;
    const bh = Math.max(0.5, v * h);
    return `<rect x="${x.toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${(bw * 0.9).toFixed(2)}" height="${bh.toFixed(1)}"/>`;
  }).join("");
  const hue = d.silent ? 0 : Math.round(200 - Math.min(1, d.centroidHz / 12000) * 160);
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" fill="hsl(${hue} 65% 55%)">${bars}</svg>`;
}

async function bandsFor(dir: string, file: string): Promise<number[]> {
  const wav = await readWav(`${dir}/${file}`);
  const frames = wav.samples.length / wav.channels;
  const mono = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < wav.channels; c++) sum += wav.samples[i * wav.channels + c];
    mono[i] = sum / wav.channels;
  }
  const { fftInPlace } = await import("./wav-metrics.ts");
  const N = 4096;
  const re = new Float64Array(N), im = new Float64Array(N);
  let onset = 0;
  for (let i = 0; i < mono.length; i++) if (Math.abs(mono[i]) > 0.002) { onset = i; break; }
  const n = Math.min(N, mono.length - onset);
  for (let i = 0; i < n; i++) {
    re[i] = mono[onset + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.max(1, n - 1)));
  }
  fftInPlace(re, im);
  const BANDS = 48, lo = 60, hi = 18000;
  const out = new Array(BANDS).fill(0);
  const binHz = wav.sampleRate / N;
  for (let bin = 1; bin < N / 2; bin++) {
    const hz = bin * binHz;
    if (hz < lo || hz > hi) continue;
    const idx = Math.min(BANDS - 1,
      Math.floor((Math.log2(hz / lo) / Math.log2(hi / lo)) * BANDS));
    out[idx] += re[bin] * re[bin] + im[bin] * im[bin];
  }
  const max = Math.max(...out, 1e-12);
  /* dB, floored at -60 and normalised, so a quiet render still shows its shape. */
  return out.map((v) => Math.max(0, (20 * Math.log10(Math.sqrt(v / max) + 1e-12) + 60) / 60));
}

async function renderHtml(
  moduleId: string,
  moduleJson: ModuleJson,
  dir: string,
  notes: Row[],
  sweeps: Array<{ param: ParamDef & { group: string }; rows: Row[] }>,
  presets: Row[]
): Promise<string> {
  const rowHtml = async (r: Row): Promise<string> => {
    const bands = await bandsFor(dir, r.file);
    return `<tr><td class="l">${escapeHtml(r.label)}</td>` +
      `<td class="s">${spectrumSvg(r.d, bands)}</td>` +
      `<td class="n">${fmtDb(r.d.peakDb)}</td>` +
      `<td class="n">${fmtMs(r.d.t60Ms)}</td>` +
      `<td class="n">${fmtHz(r.d.centroidHz)}</td>` +
      `<td class="n">${(r.d.bright * 100).toFixed(0)}%</td>` +
      `<td class="n">${r.d.flatness.toFixed(2)}</td>` +
      `<td class="f">${fingerprint(r.d)}</td>` +
      `<td><audio preload="none" controls src="${r.file}"></audio></td></tr>`;
  };

  const table = async (rows: Row[]): Promise<string> =>
    `<table><thead><tr><th></th><th>spectrum</th><th>peak</th><th>T60</th>` +
    `<th>centroid</th><th>bright</th><th>flat</th><th>reads as</th><th>listen</th></tr></thead>` +
    `<tbody>${(await Promise.all(rows.map(rowHtml))).join("")}</tbody></table>`;

  const parts: string[] = [];
  parts.push(`<h1>${escapeHtml(moduleJson.name ?? moduleId)} — sonic palette</h1>`);
  parts.push(`<p class="k">peak dBFS · T60 to −60 dB · centroid · bright = energy above 4 kHz · flat = spectral flatness 2–14 kHz</p>`);
  parts.push(`<h2>Note map</h2>`, await table(notes));

  parts.push(`<h2>Knob travel</h2>`);
  const dead = sweeps.filter(isDead);
  if (dead.length > 0) {
    parts.push(`<p class="warn">${dead.length} of ${sweeps.length} controls move nothing audible: ` +
      dead.map((s) => `<code>${escapeHtml(s.param.key)}</code>`).join(", ") + `</p>`);
  }
  for (const s of sweeps) {
    const t = travel(s.rows);
    parts.push(`<details${isDead(s) ? ' class="dead"' : ""}><summary><b>${escapeHtml(s.param.key)}</b> ` +
      `<span class="k">${escapeHtml(s.param.group)} · centroid ${t.centroid.toFixed(2)} oct · ` +
      `length ${t.length.toFixed(2)}× · flat ${t.flatness.toFixed(2)} · level ${t.level.toFixed(1)} dB · ` +
      `width ${t.width.toFixed(2)} · bright ${t.bright.toFixed(2)}` +
      (isDead(s) ? " · <b>DEAD</b>" : "") + `</span></summary>${await table(s.rows)}</details>`);
  }

  if (presets.length > 0) parts.push(`<h2>Presets</h2>`, await table(presets));

  return `<!doctype html><meta charset="utf-8"><title>${escapeHtml(moduleId)} palette</title><style>
:root{color-scheme:dark light}
body{font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;margin:24px;max-width:1200px;
 background:#14150f;color:#eee}
h1{font-size:18px} h2{font-size:15px;margin-top:28px;border-bottom:1px solid #3a3d31;padding-bottom:4px}
.k{color:#a6a696} .warn{color:#e6b422}
table{border-collapse:collapse;width:100%;margin:6px 0 14px}
th{text-align:left;font-weight:600;color:#a6a696;padding:3px 6px;font-size:11px}
td{padding:2px 6px;border-top:1px solid #26281f;vertical-align:middle}
td.n{text-align:right;color:#d8d8c0} td.l{white-space:nowrap} td.f{color:#9fbf7f}
td.s svg{display:block}
audio{height:26px;width:180px}
details{margin:2px 0;border:1px solid #26281f;border-radius:4px;padding:4px 8px}
details.dead summary{color:#e6b422}
summary{cursor:pointer}
code{color:#e6b422}
</style>${parts.join("\n")}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

await main();
