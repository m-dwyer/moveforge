import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { selectedModuleTargets } from "./lib/modules.ts";

/* Optional block-rate parameter automation. Ramps catch zipper noise and
 * unsmoothed gains; step lists catch discontinuities (a delay time jumping the
 * read pointer, filter coefficients recomputed at a block boundary).
 *
 *   "automate": [{ "key": "cutoff", "from": 0.1, "to": 0.9 },
 *                { "key": "sync", "steps": [0, 4, 7] }]
 */
type Automation =
  | { key: string; from: number; to: number; cycles?: number }
  | { key: string; steps: number[] };

/* `sparse: true` marks a render that is legitimately mostly silence (a bare
 * impulse into an FX). Read by check-renders; relaxes only the silence floor. */
type CommonRender = {
  automate?: Automation[];
  sparse?: boolean;
};

/* One step of a render pattern: the notes fired together on that step, each with
 * its own velocity. `[]` is a rest, and a bare number means that note at the
 * render's `velocity`.
 *
 *   "pattern": [[{ "note": 36, "vel": 110 }, { "note": 39, "vel": 96 }], [], [42]]
 *
 * A flat `notes` array is the older, monophonic spelling and still works — it
 * expands to one note per step at the scalar `velocity`, which is byte-identical
 * to what it always rendered. Give one or the other, never both.
 *
 * Polyphony is not cosmetic: with one note per step no golden can exercise voice
 * summing, gain staging under simultaneity, choke groups, or per-voice velocity,
 * which for a note-mapped multi-voice module is the whole behaviour under test. */
type PatternNote = number | { note: number; vel?: number };
type PatternStep = PatternNote[];

type SoundGenRender = CommonRender & {
  file: string;
  gate_blocks: number;
  note_blocks: number;
  notes?: number[];
  pattern?: PatternStep[];
  seconds: number;
  tail_seconds?: number;
  velocity?: number;
};

type AudioFxRender = CommonRender & {
  file: string;
  seconds?: number;
  signal?: "sweep" | "noise" | "impulse" | "silence";
};

type MidiFxRender = CommonRender & {
  file: string;
  blocks?: number;
  gate_blocks?: number;
  note_blocks?: number;
  notes?: number[];
  velocity?: number;
};

/* Only reached when a pattern gives every note its own velocity, so the scalar is
 * never consulted. A note without a `vel` makes `velocity` mandatory instead —
 * quietly hitting at some default is how a whole render measures the wrong
 * dynamic. */
const DEFAULT_VELOCITY = 100;

type PresetSuite = {
  presets: Array<{
    params: Record<string, number>;
    render?: SoundGenRender | AudioFxRender | MidiFxRender;
  }>;
};

for (const target of await selectedModuleTargets()) {
  const moduleId = target.id;
  const paths = target.paths;
  const envKind = process.env.RENDER_KIND;
  const kind: "sound_generator" | "audio_fx" | "midi_fx" =
    envKind === "audio_fx" ? "audio_fx" :
    envKind === "midi_fx" ? "midi_fx" :
    target.renderKind ?? "sound_generator";
  const renderBin = process.env.RENDER_BIN || target.renderBin;
  const data = JSON.parse(await readFile(paths.presets, "utf8")) as PresetSuite;

  for (const preset of data.presets) {
    const render = preset.render;
    if (!render) continue;

    const outPath = `${paths.suiteDir}/${render.file}`;
    let args: string[];

    if (kind === "audio_fx") {
      const fx = render as AudioFxRender;
      args = [outPath, "--signal", fx.signal ?? "sweep", "--seconds", String(fx.seconds ?? 4)];
    } else if (kind === "midi_fx") {
      const mfx = render as MidiFxRender;
      args = [outPath];
      if (mfx.blocks !== undefined) args.push("--blocks", String(mfx.blocks));
      if (mfx.notes !== undefined) args.push("--notes", mfx.notes.join(","));
      if (mfx.velocity !== undefined) args.push("--velocity", String(mfx.velocity));
      if (mfx.gate_blocks !== undefined) args.push("--gate-blocks", String(mfx.gate_blocks));
      if (mfx.note_blocks !== undefined) args.push("--note-blocks", String(mfx.note_blocks));
    } else {
      const sg = render as SoundGenRender;
      args = [
        "--render",
        outPath,
        String(sg.seconds),
        String(sg.note_blocks),
        String(sg.gate_blocks),
        String(sg.velocity ?? DEFAULT_VELOCITY),
        patternSpec(sg)
      ];
      /* Stop triggering before the end so a long decay is actually captured;
       * without it the recorded tail can never exceed one note interval. */
      if (sg.tail_seconds !== undefined) {
        args.push("--tail-seconds", String(sg.tail_seconds));
      }
    }

    for (const [key, value] of Object.entries(preset.params)) {
      args.push(`${key}=${value}`);
    }

    for (const a of (render as CommonRender).automate ?? []) {
      args.push("--automate", automationSpec(a));
    }

    const result = spawnSync(renderBin, args, { stdio: "inherit" });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}

/* Encode a render's steps for render_wav's positional pattern argument: steps
 * separated by ",", simultaneous notes by "+", velocity after ":". See
 * tools/render_pattern.h for the grammar. */
function patternSpec(sg: SoundGenRender): string {
  const where = `render "${sg.file}"`;
  if (sg.pattern && sg.notes) {
    throw new Error(`${where}: has both "pattern" and "notes" — give one or the other`);
  }
  if (!sg.pattern && !sg.notes) {
    throw new Error(`${where}: needs either "pattern" (polyphonic) or "notes" (one per step)`);
  }
  if (sg.velocity !== undefined &&
      (!Number.isInteger(sg.velocity) || sg.velocity < 1 || sg.velocity > 127)) {
    throw new Error(`${where}: velocity ${sg.velocity} must be an integer in 1..127`);
  }

  const steps: PatternStep[] = sg.pattern ?? sg.notes!.map((note) => [note]);
  if (steps.length === 0) throw new Error(`${where}: pattern is empty`);
  if (steps.every((step) => step.length === 0)) {
    throw new Error(`${where}: every step is a rest, so the render is silence`);
  }

  return steps
    .map((step, stepIndex) => {
      if (!Array.isArray(step)) {
        throw new Error(`${where}: step ${stepIndex + 1} is not an array of notes`);
      }
      return step.map((entry) => noteSpec(entry, `${where} step ${stepIndex + 1}`, sg)).join("+");
    })
    .join(",");
}

function noteSpec(entry: PatternNote, where: string, sg: SoundGenRender): string {
  const note = typeof entry === "number" ? entry : entry.note;
  const vel = typeof entry === "number" ? undefined : entry.vel;

  if (!Number.isInteger(note) || note < 0 || note > 127) {
    throw new Error(`${where}: note ${note} must be an integer in 0..127`);
  }
  if (vel === undefined) {
    if (sg.velocity === undefined) {
      throw new Error(
        `${where}: note ${note} has no "vel", so the render needs a "velocity" to fall back on`
      );
    }
    return String(note);
  }
  if (!Number.isInteger(vel) || vel < 1 || vel > 127) {
    throw new Error(`${where}: note ${note} has vel ${vel}, which must be an integer in 1..127`);
  }
  return `${note}:${vel}`;
}

function automationSpec(a: Automation): string {
  if ("steps" in a) return `${a.key}=${a.steps.join(",")}`;
  const cycles = a.cycles && a.cycles > 1 ? `x${a.cycles}` : "";
  return `${a.key}=${a.from}..${a.to}${cycles}`;
}
