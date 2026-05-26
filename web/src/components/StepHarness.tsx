import { useEffect } from "react";
import { useStore } from "@/store";
import { noteOff, noteOn } from "@/audio";
import { Slider } from "@/components/ui/slider";
import { noteLabel } from "@/lib/pads";
import { cn } from "@/lib/utils";

const STEP_INTERVAL_MS = 240;

export function StepHarness() {
  const steps = useStore((s) => s.steps);
  const selectedStep = useStore((s) => s.selectedStep);
  const playing = useStore((s) => s.playing);
  const playStep = useStore((s) => s.playStep);
  const setPlaying = useStore((s) => s.setPlaying);
  const toggleStep = useStore((s) => s.toggleStep);
  const selectStep = useStore((s) => s.selectStep);
  const setStepNote = useStore((s) => s.setStepNote);
  const setStepVelocity = useStore((s) => s.setStepVelocity);

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
    const id = setInterval(tick, STEP_INTERVAL_MS);
    return () => {
      clearInterval(id);
      if (prev !== null) noteOff(prev);
    };
  }, [playing]);

  const step = steps[selectedStep];

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setPlaying(!playing)}
          className={cn(
            "rounded border px-4 py-1.5 text-sm font-medium transition-colors",
            playing ? "border-accent bg-accent text-bg" : "border-line bg-panel-2 hover:border-accent/40"
          )}
        >
          {playing ? "Stop" : "Play"}
        </button>
        <span className="text-xs text-muted">
          16 steps · {STEP_INTERVAL_MS}ms · click to toggle, shift-click to select
        </span>
      </div>

      <div className="grid grid-cols-[repeat(16,minmax(0,1fr))] gap-1">
        {steps.map((s, i) => (
          <button
            key={i}
            type="button"
            onClick={(e) => (e.shiftKey ? selectStep(i) : toggleStep(i))}
            title={`Step ${i + 1} · ${noteLabel(s.note)}`}
            className={cn(
              "aspect-square rounded border text-[10px] font-mono transition-colors",
              s.enabled ? "border-accent bg-[#243527] text-text" : "border-line bg-panel-2 text-muted",
              selectedStep === i && "ring-2 ring-warn ring-inset",
              playStep === i && "bg-accent text-bg"
            )}
          >
            {i + 1}
          </button>
        ))}
      </div>

      <div className="rounded-md border border-line bg-panel-2 p-3">
        <div className="mb-2 flex items-baseline justify-between text-xs">
          <span className="font-medium">Step {selectedStep + 1}</span>
          <span className="text-muted">{step.enabled ? "enabled" : "disabled"}</span>
        </div>
        <div className="grid grid-cols-[60px_1fr_auto] items-center gap-3">
          <label className="text-xs">Note</label>
          <Slider
            value={[step.note]}
            min={24}
            max={108}
            step={1}
            onValueChange={(v) => setStepNote(selectedStep, v[0])}
          />
          <span className="w-12 text-right font-mono text-xs text-warn">{noteLabel(step.note)}</span>

          <label className="text-xs">Vel</label>
          <Slider
            value={[step.velocity]}
            min={0}
            max={1}
            step={0.01}
            onValueChange={(v) => setStepVelocity(selectedStep, v[0])}
          />
          <span className="w-12 text-right font-mono text-xs text-warn">{step.velocity.toFixed(2)}</span>
        </div>
      </div>
    </section>
  );
}
