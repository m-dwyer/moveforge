import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { modulePaths, selectedModuleId } from "./lib/modules.ts";

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

type PresetSuite = {
  presets: Array<{
    params: Record<string, number>;
    render?: SoundGenRender | AudioFxRender;
  }>;
};

const moduleId = selectedModuleId();
const paths = modulePaths(moduleId);
const kind = process.env.RENDER_KIND === "audio_fx" ? "audio_fx" : "sound_generator";
const defaultBin = kind === "audio_fx" ? `./build/render_fx_${moduleId}` : `./build/render_wav_${moduleId}`;
const renderBin = process.env.RENDER_BIN || defaultBin;
const data = JSON.parse(await readFile(paths.presets, "utf8")) as PresetSuite;

for (const preset of data.presets) {
  const render = preset.render;
  if (!render) continue;

  const outPath = `${paths.suiteDir}/${render.file}`;
  let args: string[];

  if (kind === "audio_fx") {
    const fx = render as AudioFxRender;
    args = [outPath, "--signal", fx.signal ?? "sweep", "--seconds", String(fx.seconds ?? 4)];
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
