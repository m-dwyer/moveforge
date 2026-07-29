import { scales, type ScaleName } from "@/chain-state";

type Config = {
  padLayout: "chromatic" | "in-key-octaves" | "in-key-fourths" | "kit";
  root: number;
  scale: ScaleName;
  octave: number;
  /* The sound module's own note-block root, when it declares one. A note-mapped
   * drum module puts its voices on consecutive notes from there, and expecting the
   * player to line the grid up with it by hand is how you end up with 26 silent
   * pads and no way to tell which six are not. */
  moduleRoot?: number;
};

export function noteForPad(index: number, cfg: Config): number {
  const rootMidi = 12 * (cfg.octave + 1) + cfg.root;
  /* Kit: every row is the same eight notes from the module's root, so the voices sit
   * in the same column on every row and there is nothing to align. The melodic
   * layouts stagger rows by fourths or octaves, which for a six-voice drum module
   * means most of the grid lands past the last voice and is silent. */
  if (cfg.padLayout === "kit") {
    return (cfg.moduleRoot ?? rootMidi) + (index % 8);
  }
  if (cfg.padLayout === "chromatic") {
    const row = Math.floor(index / 8);
    const col = index % 8;
    return rootMidi + row * 5 + col;
  }
  const scale = scales[cfg.scale] ?? scales.major;
  if (cfg.padLayout === "in-key-fourths") {
    const row = Math.floor(index / 8);
    const col = index % 8;
    const degree = col + row * 3;
    return rootMidi + 12 * Math.floor(degree / scale.length) + scale[degree % scale.length];
  }
  const degree = index % 8;
  const row = Math.floor(index / 8);
  const wrapped = degree % scale.length;
  const extraOctave = Math.floor(degree / scale.length);
  return rootMidi + row * 12 + extraOctave * 12 + scale[wrapped];
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function noteLabel(note: number): string {
  return `${NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 1}`;
}

export function noteShortLabel(note: number): string {
  return NOTE_NAMES[note % 12];
}

export function isRoot(note: number, root: number): boolean {
  return ((note - root) % 12 + 12) % 12 === 0;
}

export function isInScale(note: number, root: number, scale: ScaleName): boolean {
  const pc = ((note - root) % 12 + 12) % 12;
  return (scales[scale] ?? scales.major).includes(pc);
}

export { NOTE_NAMES };
