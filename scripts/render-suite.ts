import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { modulePaths, readModuleTarget, selectedModuleIds } from "./lib/modules.ts";

type SoundGenRender = {
  file: string;
  gate_blocks: number;
  note_blocks: number;
  notes: number[];
  seconds: number;
  velocity: number;
};

type AudioFxRender = {
  file: string;
  seconds?: number;
  signal?: "sweep" | "noise" | "impulse" | "silence";
};

type MidiFxRender = {
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

for (const moduleId of await selectedModuleIds()) {
  const paths = modulePaths(moduleId);
  const target = await readModuleTarget(moduleId);
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
    }

    for (const [key, value] of Object.entries(preset.params)) {
      args.push(`${key}=${value}`);
    }

    const result = spawnSync(renderBin, args, { stdio: "inherit" });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
