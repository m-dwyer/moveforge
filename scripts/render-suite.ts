import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

type PresetSuite = {
  presets: Array<{
    params: Record<string, number>;
    render?: {
      file: string;
      gate_blocks: number;
      note_blocks: number;
      notes: number[];
      seconds: number;
      velocity: number;
    };
  }>;
};

const moduleId = process.env.MODULE_ID || "westfold";
const renderBin = process.env.RENDER_BIN || `./build/render_wav_${moduleId}`;
const data = JSON.parse(await readFile(`src/modules/${moduleId}/presets.json`, "utf8")) as PresetSuite;

for (const preset of data.presets) {
  const render = preset.render;
  if (!render) continue;

  const args = [
    "--render",
    `renders/${moduleId}-suite/${render.file}`,
    String(render.seconds),
    String(render.note_blocks),
    String(render.gate_blocks),
    String(render.velocity),
    render.notes.join(",")
  ];

  for (const [key, value] of Object.entries(preset.params)) {
    args.push(`${key}=${value}`);
  }

  const result = spawnSync(renderBin, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
