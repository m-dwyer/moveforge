import { useStore } from "@/store";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NOTE_NAMES } from "@/lib/pads";
import type { ScaleName } from "@/chain-state";

const LAYOUTS: Array<{ value: "in-key-octaves" | "in-key-fourths" | "chromatic"; label: string }> = [
  { value: "in-key-octaves", label: "In-Key Octaves" },
  { value: "in-key-fourths", label: "In-Key 4ths" },
  { value: "chromatic", label: "Chromatic" }
];

export const SCALE_OPTIONS: Array<{ value: ScaleName; label: string }> = [
  { value: "major", label: "Major" },
  { value: "natural_minor", label: "Natural Minor" },
  { value: "harmonic_minor", label: "Harmonic Minor" },
  { value: "melodic_minor", label: "Melodic Minor" },
  { value: "major_pentatonic", label: "Major Pentatonic" },
  { value: "minor_pentatonic", label: "Minor Pentatonic" },
  { value: "blues", label: "Blues" },
  { value: "dorian", label: "Dorian" },
  { value: "phrygian", label: "Phrygian" },
  { value: "lydian", label: "Lydian" },
  { value: "mixolydian", label: "Mixolydian" },
  { value: "locrian", label: "Locrian" },
  { value: "whole_tone", label: "Whole Tone" },
  { value: "diminished", label: "Diminished" }
];

export function PadConfig() {
  const padLayout = useStore((s) => s.padLayout);
  const root = useStore((s) => s.root);
  const scaleName = useStore((s) => s.scale);
  const octave = useStore((s) => s.octave);
  const setPadLayout = useStore((s) => s.setPadLayout);
  const setRoot = useStore((s) => s.setRoot);
  const setScale = useStore((s) => s.setScale);
  const setOctave = useStore((s) => s.setOctave);

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr]">
      <Field label="Pad Layout">
        <Select value={padLayout} onValueChange={(v) => setPadLayout(v as typeof padLayout)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LAYOUTS.map((l) => (
              <SelectItem key={l.value} value={l.value}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Root">
        <Select value={String(root)} onValueChange={(v) => setRoot(Number(v))}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {NOTE_NAMES.map((name, i) => (
              <SelectItem key={i} value={String(i)}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Scale">
        <Select value={scaleName} onValueChange={(v) => setScale(v as typeof scaleName)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SCALE_OPTIONS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Octave">
        <input
          type="number"
          min={1}
          max={6}
          value={octave}
          onChange={(e) => setOctave(Math.max(1, Math.min(6, Number(e.target.value) || 3)))}
          className="h-9 w-full rounded-md border border-line bg-panel-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted">
      {label}
      {children}
    </label>
  );
}
