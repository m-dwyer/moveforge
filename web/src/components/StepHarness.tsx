import { useEffect } from "react";
import { useStore } from "@/store";
import { noteOff, noteOn } from "@/audio";
import { Slider } from "@/components/ui/slider";
import { noteLabel } from "@/lib/pads";
import { cn } from "@/lib/utils";

export function StepHarness() {
  const steps = useStore((s) => s.steps);
  const selectedStep = useStore((s) => s.selectedStep);
  const playing = useStore((s) => s.playing);
  const playStep = useStore((s) => s.playStep);
  const bpm = useStore((s) => s.bpm);
  const setPlaying = useStore((s) => s.setPlaying);
  const setBpm = useStore((s) => s.setBpm);
  const toggleStep = useStore((s) => s.toggleStep);
  const selectStep = useStore((s) => s.selectStep);
  const setStepNote = useStore((s) => s.setStepNote);
  const setStepVelocity = useStore((s) => s.setStepVelocity);

  // 16th notes at the current BPM.
  const intervalMs = Math.max(20, Math.round(60_000 / (bpm * 4)));

  useEffect(() => {
    if (!playing) return;
    let prev: number | null = null;

    const tick = () => {
      const s = useStore.getState();
      if (prev !== null) noteOff(prev);
      prev = null;
      const next = (s.playStep + 1) % s.steps.length;
      s.setPlayStep(next);
      const step = s.steps[next];
      if (step.enabled) {
        void noteOn(step.note, step.velocity);
        prev = step.note;
      }
    };

    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      clearInterval(id);
      if (prev !== null) noteOff(prev);
    };
  }, [playing, intervalMs]);

  const step = steps[selectedStep];

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setPlaying(!playing)}
          className={cn(
            "shrink-0 rounded border px-3 py-1.5 text-xs font-medium transition-colors",
            playing ? "border-accent bg-accent text-bg" : "border-line bg-panel-2 hover:border-accent/40"
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
            className="h-7 w-14 rounded border border-line bg-panel-2 px-1.5 text-center text-text focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>
        <div className="grid flex-1 grid-cols-[repeat(16,minmax(0,1fr))] gap-0.5">
          {steps.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={(e) => (e.shiftKey ? selectStep(i) : toggleStep(i))}
              title={`Step ${i + 1} · ${noteLabel(s.note)} · click toggle · shift-click select`}
              className={cn(
                "aspect-square rounded-sm border text-[11px] font-mono transition-colors",
                s.enabled ? "border-accent bg-[#243527] text-text" : "border-line bg-panel-2 text-muted",
                selectedStep === i && "ring-2 ring-warn ring-inset",
                playStep === i && "bg-accent text-bg"
              )}
            >
              {i + 1}
            </button>
          ))}
        </div>
      </div>
      <p className="text-[11px] text-muted">
        Click step to toggle · shift-click to select for editing · 16ths at {bpm} BPM ({intervalMs}ms)
      </p>

      <div className="rounded-md border border-line bg-panel-2 p-2 text-xs">
        <div className="mb-1 flex items-baseline justify-between">
          <span className="font-medium">Step {selectedStep + 1}</span>
          <span className="text-muted">{step.enabled ? "enabled" : "disabled"}</span>
        </div>
        <div className="grid grid-cols-[40px_1fr_48px] items-center gap-2">
          <label>Note</label>
          <Slider
            value={[step.note]}
            min={24}
            max={108}
            step={1}
            onValueChange={(v) => setStepNote(selectedStep, v[0])}
          />
          <span className="text-right font-mono text-warn">{noteLabel(step.note)}</span>

          <label>Vel</label>
          <Slider
            value={[step.velocity]}
            min={0}
            max={1}
            step={0.01}
            onValueChange={(v) => setStepVelocity(selectedStep, v[0])}
          />
          <span className="text-right font-mono text-warn">{step.velocity.toFixed(2)}</span>
        </div>
      </div>
    </section>
  );
}
