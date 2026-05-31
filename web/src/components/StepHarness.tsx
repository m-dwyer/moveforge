import { useEffect } from "react";
import { useStore } from "@/store";
import { noteOff, noteOn } from "@/audio";
import { Slider } from "@/components/ui/slider";
import { noteLabel } from "@/lib/pads";
import { cn } from "@/lib/utils";
import type { AuditionPatternName, StepState } from "@/chain-state";

const patternLabels: Record<AuditionPatternName, string> = {
  custom: "Custom Steps",
  custom_copy: "Custom Copy",
  bass_pulse: "Bass Pulse",
  octave_bounce: "Octave Bounce",
  drone_hold: "Drone Hold",
  chord_stab: "Chord/Stab",
  velocity_ramp: "Velocity Ramp",
  acid_line: "Acid Line",
  minor_hook: "Minor Hook",
  fifths: "Fifths",
  syncopated_stab: "Syncopated Stab"
};

export function StepHarness() {
  const steps = useStore((s) => s.steps);
  const customCopySteps = useStore((s) => s.customCopySteps);
  const selectedStep = useStore((s) => s.selectedStep);
  const playing = useStore((s) => s.playing);
  const playStep = useStore((s) => s.playStep);
  const bpm = useStore((s) => s.bpm);
  const audition = useStore((s) => s.audition);
  const root = useStore((s) => s.root);
  const octave = useStore((s) => s.octave);
  const setPlaying = useStore((s) => s.setPlaying);
  const setBpm = useStore((s) => s.setBpm);
  const setAuditionPattern = useStore((s) => s.setAuditionPattern);
  const setAuditionLength = useStore((s) => s.setAuditionLength);
  const setAuditionGate = useStore((s) => s.setAuditionGate);
  const setAuditionTranspose = useStore((s) => s.setAuditionTranspose);
  const setAuditionVelocity = useStore((s) => s.setAuditionVelocity);
  const toggleStep = useStore((s) => s.toggleStep);
  const selectStep = useStore((s) => s.selectStep);
  const setStepNote = useStore((s) => s.setStepNote);
  const setStepVelocity = useStore((s) => s.setStepVelocity);
  const forkAuditionToCustomCopy = useStore((s) => s.forkAuditionToCustomCopy);
  const toggleCustomCopyStep = useStore((s) => s.toggleCustomCopyStep);
  const setCustomCopyStepNote = useStore((s) => s.setCustomCopyStepNote);
  const setCustomCopyStepVelocity = useStore((s) => s.setCustomCopyStepVelocity);

  // 16th notes at the current BPM.
  const intervalMs = Math.max(20, Math.round(60_000 / (bpm * 4)));

  useEffect(() => {
    if (!playing) return;
    const noteOffTimers = new Set<number>();
    const activeNotes = new Set<number>();

    const tick = () => {
      const s = useStore.getState();
      const next = (s.playStep + 1) % s.audition.length;
      s.setPlayStep(next);
      const event = auditionEvent(s.audition.pattern, next, {
        steps: s.audition.pattern === "custom_copy" ? s.customCopySteps : s.steps,
        root: s.root,
        octave: s.octave,
        transpose: s.audition.transpose,
        velocity: s.audition.velocity
      });
      if (event) {
        if (activeNotes.has(event.note)) noteOff(event.note);
        activeNotes.add(event.note);
        void noteOn(event.note, event.velocity);
        const gateMs = Math.max(15, Math.round(intervalMs * Math.min(0.98, s.audition.gate) * event.gateSteps));
        const timer = window.setTimeout(() => {
          noteOff(event.note);
          activeNotes.delete(event.note);
          noteOffTimers.delete(timer);
        }, gateMs);
        noteOffTimers.add(timer);
      }
    };

    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      clearInterval(id);
      for (const timer of noteOffTimers) clearTimeout(timer);
      noteOffTimers.clear();
      for (const note of activeNotes) noteOff(note);
      activeNotes.clear();
    };
  }, [playing, intervalMs]);

  const customCopyPattern = audition.pattern === "custom_copy";
  const customPattern = audition.pattern === "custom";
  const editablePattern = customPattern || customCopyPattern;
  const activeSteps = customCopyPattern ? customCopySteps : steps;
  const step = activeSteps[selectedStep] ?? defaultStep();
  const sourceSteps = editablePattern ? activeSteps : steps;
  const visibleSteps = Array.from({ length: audition.length }, (_, index) => sourceSteps[index] ?? defaultStep());

  const forkGeneratedPattern = (index: number, toggleClickedStep: boolean) => {
    const forked = materializePattern(audition.pattern, {
      steps,
      root,
      octave,
      transpose: audition.transpose,
      velocity: audition.velocity
    });
    forkAuditionToCustomCopy(forked);
    selectStep(index);
    if (toggleClickedStep) toggleCustomCopyStep(index);
  };

  return (
    <section className="rounded-md border border-line bg-panel-2 p-3">
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

      <div className="space-y-2">
        <div className="grid grid-cols-[repeat(8,minmax(0,1fr))] gap-1 sm:grid-cols-[repeat(16,minmax(0,1fr))]">
          {visibleSteps.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={(e) => {
                if (!editablePattern) return forkGeneratedPattern(i, !e.shiftKey);
                if (e.shiftKey) return selectStep(i);
                if (customCopyPattern) return toggleCustomCopyStep(i);
                return toggleStep(i);
              }}
              title={editablePattern
                ? `Step ${i + 1} · ${noteLabel(s.note)} · click toggle · shift-click select`
                : `Step ${i + 1} · ${patternLabels[audition.pattern]} · click to make Custom Copy`}
              className={cn(
                "relative h-12 overflow-hidden rounded-sm border text-sm font-mono transition-colors sm:h-10",
                stepHasEvent(editablePattern, audition.pattern, i, s, { steps, root, octave, transpose: audition.transpose, velocity: audition.velocity })
                  ? "border-accent bg-[#243527] text-text"
                  : "border-line bg-panel-2 text-muted",
                selectedStep === i && "ring-2 ring-warn ring-inset",
                playStep === i && "bg-accent text-bg"
              )}
            >
              {stepHasEvent(editablePattern, audition.pattern, i, s, { steps, root, octave, transpose: audition.transpose, velocity: audition.velocity }) && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 bottom-0 h-1 bg-accent/80"
                  style={{ width: `${Math.max(5, audition.gate * 100)}%` }}
                />
              )}
              <span className="relative">{i + 1}</span>
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted">
          {editablePattern ? "Click step to toggle · shift-click to select for editing" : "Click a generated step to fork it into Custom Copy"}
          {" · "}16ths at {bpm} BPM ({intervalMs}ms) · note length {(audition.gate * 100).toFixed(0)}% · transpose {audition.transpose}
        </p>
      </div>

      <div className={cn("mt-3 rounded-md border border-line bg-bg p-2 text-xs", !editablePattern && "opacity-60")}>
        <div className="mb-1 flex items-baseline justify-between">
          <span className="font-medium">Step {selectedStep + 1}</span>
          <span className="text-muted">{editablePattern ? (step.enabled ? "enabled" : "disabled") : "click a step to fork"}</span>
        </div>
        <div className="grid grid-cols-[40px_1fr_48px] items-center gap-2">
          <label>Note</label>
          <Slider
            value={[step.note]}
            min={24}
            max={108}
            step={1}
            disabled={!editablePattern}
            onValueChange={(v) => customCopyPattern ? setCustomCopyStepNote(selectedStep, v[0]) : setStepNote(selectedStep, v[0])}
          />
          <span className="text-right font-mono text-warn">{noteLabel(step.note)}</span>

          <label>Vel</label>
          <Slider
            value={[step.velocity]}
            min={0}
            max={1}
            step={0.01}
            disabled={!editablePattern}
            onValueChange={(v) => customCopyPattern ? setCustomCopyStepVelocity(selectedStep, v[0]) : setStepVelocity(selectedStep, v[0])}
          />
          <span className="text-right font-mono text-warn">{step.velocity.toFixed(2)}</span>
        </div>
      </div>
    </section>
  );
}

type PatternContext = {
  octave: number;
  root: number;
  steps: StepState[];
  transpose: number;
  velocity: number;
};

type AuditionEvent = {
  gateSteps: number;
  note: number;
  velocity: number;
};

function stepHasEvent(
  customPattern: boolean,
  pattern: AuditionPatternName,
  index: number,
  step: StepState,
  context: PatternContext
): boolean {
  return customPattern ? step.enabled : auditionEvent(pattern, index, context) !== null;
}

function auditionEvent(pattern: AuditionPatternName, index: number, context: PatternContext): AuditionEvent | null {
  if (pattern === "custom" || pattern === "custom_copy") {
    const step = context.steps[index];
    return step?.enabled ? { note: step.note, velocity: step.velocity, gateSteps: 1 } : null;
  }

  const rootNote = 12 * (context.octave + 1) + context.root + context.transpose;
  const velocity = context.velocity;

  if (pattern === "bass_pulse") {
    const position = index % 16;
    const hits = [0, 3, 6, 8, 10, 14];
    if (!hits.includes(position)) return null;
    return { note: rootNote - 12, velocity, gateSteps: stepsUntilNextHit(position, hits, 16) };
  }
  if (pattern === "octave_bounce") {
    if (index % 2 !== 0) return null;
    return { note: rootNote - 12 + (index % 8 === 4 ? 12 : 0), velocity, gateSteps: 2 };
  }
  if (pattern === "drone_hold") {
    return index === 0 ? { note: rootNote - 12, velocity, gateSteps: 16 } : null;
  }
  if (pattern === "chord_stab") {
    const position = index % 16;
    const hits = [0, 4, 10];
    if (!hits.includes(position)) return null;
    return { note: rootNote + (position === 10 ? 3 : 0), velocity, gateSteps: stepsUntilNextHit(position, hits, 16) };
  }
  if (pattern === "velocity_ramp") {
    if (index % 2 !== 0) return null;
    const ramp = 0.35 + (index % 16) / 15 * 0.65;
    return { note: rootNote - 12, velocity: Math.min(1, velocity * ramp), gateSteps: 2 };
  }
  if (pattern === "acid_line") {
    const phrase = [0, null, 12, 10, null, 7, 3, null, 0, 3, null, 7, 10, null, 12, 7] as const;
    const offset = phrase[index % phrase.length];
    if (offset === null) return null;
    const accent = index % 8 === 0 || index % 16 === 14 ? 1 : 0.78;
    return { note: rootNote - 12 + offset, velocity: Math.min(1, velocity * accent), gateSteps: 1 };
  }
  if (pattern === "minor_hook") {
    const phrase = [0, 3, 5, 7, 10, 7, 5, 3] as const;
    if (index % 2 !== 0) return null;
    return { note: rootNote - 12 + phrase[(index / 2) % phrase.length], velocity, gateSteps: 2 };
  }
  if (pattern === "fifths") {
    const phrase = [0, 7, 12, 7] as const;
    if (index % 4 !== 0) return null;
    return { note: rootNote - 12 + phrase[(index / 4) % phrase.length], velocity, gateSteps: 4 };
  }
  if (pattern === "syncopated_stab") {
    const position = index % 16;
    const hits = [0, 5, 7, 11, 14];
    if (!hits.includes(position)) return null;
    const offset = position === 11 ? 10 : position === 14 ? 7 : 0;
    return { note: rootNote + offset, velocity, gateSteps: 1 };
  }
  return null;
}

function materializePattern(pattern: AuditionPatternName, context: PatternContext): StepState[] {
  return context.steps.map((step, index) => {
    const event = auditionEvent(pattern, index, context);
    return {
      enabled: event !== null,
      note: event?.note ?? step.note,
      velocity: event?.velocity ?? context.velocity,
      locks: {}
    };
  });
}

function defaultStep(): StepState {
  return { enabled: false, note: 60, velocity: 0.9, locks: {} };
}

function stepsUntilNextHit(position: number, hits: number[], cycleLength: number): number {
  for (const hit of hits) {
    if (hit > position) return hit - position;
  }
  return cycleLength - position + hits[0];
}
