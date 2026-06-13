import { useStore } from "@/store";

export function OctaveButtons() {
  const octave = useStore((s) => s.octave);
  const setOctave = useStore((s) => s.setOctave);
  const step = (delta: number) => setOctave(Math.max(1, Math.min(6, octave + delta)));
  const btn =
    "rounded border border-line bg-panel-2 px-3 py-2 text-sm transition-colors hover:border-accent/40 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="flex items-center justify-center gap-2">
      <button type="button" className={btn} disabled={octave <= 1} onClick={() => step(-1)}>
        Oct −
      </button>
      <span className="w-12 text-center font-mono text-sm text-muted">Oct {octave}</span>
      <button type="button" className={btn} disabled={octave >= 6} onClick={() => step(1)}>
        Oct +
      </button>
    </div>
  );
}
