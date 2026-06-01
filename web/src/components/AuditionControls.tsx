import { useStore } from "@/store";
import { Slider } from "@/components/ui/slider";
import { patternLabels } from "@/audition-patterns";
import type { AuditionPatternName } from "@/chain-state";
import { cn } from "@/lib/utils";

type Props = {
  intervalMs: number;
};

export function AuditionControls({ intervalMs }: Props) {
  const playing = useStore((s) => s.playing);
  const bpm = useStore((s) => s.bpm);
  const audition = useStore((s) => s.audition);
  const setPlaying = useStore((s) => s.setPlaying);
  const setBpm = useStore((s) => s.setBpm);
  const setAuditionPattern = useStore((s) => s.setAuditionPattern);
  const setAuditionLength = useStore((s) => s.setAuditionLength);
  const setAuditionGate = useStore((s) => s.setAuditionGate);
  const setAuditionTranspose = useStore((s) => s.setAuditionTranspose);
  const setAuditionVelocity = useStore((s) => s.setAuditionVelocity);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPlaying(!playing)}
            className={cn(
              "h-8 shrink-0 rounded border px-3 text-xs font-medium transition-colors",
              playing ? "border-accent bg-accent text-bg" : "border-line bg-bg hover:border-accent/40"
            )}
          >
            {playing ? "Stop" : "Play"}
          </button>
          <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
            BPM
            <input
              type="number"
              min={40}
              max={240}
              value={bpm}
              onChange={(e) => setBpm(Number(e.target.value) || 120)}
              className="h-8 w-14 rounded border border-line bg-bg px-1.5 text-center text-text focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </label>
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-xs">
          <select
            aria-label="Audition pattern"
            value={audition.pattern}
            onChange={(e) => setAuditionPattern(e.target.value as AuditionPatternName)}
            className="h-8 min-w-[150px] rounded border border-line bg-bg px-2 text-text focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {Object.entries(patternLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select
            aria-label="Audition length"
            value={audition.length}
            onChange={(e) => setAuditionLength(Number(e.target.value) as 8 | 16 | 32)}
            className="h-8 w-[92px] rounded border border-line bg-bg px-2 text-text focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value={8}>8 steps</option>
            <option value={16}>16 steps</option>
            <option value={32}>32 steps</option>
          </select>
          <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted" title="Transpose generated audition patterns in semitones. Custom steps keep their programmed notes.">
            Trans
            <input
              type="number"
              min={-24}
              max={24}
              value={audition.transpose}
              onChange={(e) => setAuditionTranspose(Number(e.target.value) || 0)}
              className="h-8 w-14 rounded border border-line bg-bg px-1.5 text-center text-text focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </label>
          <label className="flex min-w-[140px] flex-1 items-center gap-2 text-muted" title="Note length as a percentage of each sequencer step. Lower values are shorter and more staccato.">
            Note Len
            <Slider value={[audition.gate]} min={0.05} max={1} step={0.01} onValueChange={(v) => setAuditionGate(v[0])} />
            <span className="w-9 text-right font-mono text-warn">{(audition.gate * 100).toFixed(0)}%</span>
          </label>
          <label className="flex min-w-[120px] flex-1 items-center gap-2 text-muted">
            Vel
            <Slider value={[audition.velocity]} min={0.05} max={1} step={0.01} onValueChange={(v) => setAuditionVelocity(v[0])} />
            <span className="w-8 text-right font-mono text-warn">{audition.velocity.toFixed(2)}</span>
          </label>
        </div>
      </div>
      <p className="text-[11px] text-muted">
        16ths at {bpm} BPM ({intervalMs}ms) · note length {(audition.gate * 100).toFixed(0)}% · transpose {audition.transpose}
      </p>
    </>
  );
}
