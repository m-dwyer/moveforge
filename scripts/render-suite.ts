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

type SoundGenRender = CommonRender & {
  file: string;
  gate_blocks: number;
  note_blocks: number;
  notes: number[];
  seconds: number;
  tail_seconds?: number;
  velocity: number;
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
        String(sg.velocity),
        sg.notes.join(",")
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

function automationSpec(a: Automation): string {
  if ("steps" in a) return `${a.key}=${a.steps.join(",")}`;
  const cycles = a.cycles && a.cycles > 1 ? `x${a.cycles}` : "";
  return `${a.key}=${a.from}..${a.to}${cycles}`;
}
