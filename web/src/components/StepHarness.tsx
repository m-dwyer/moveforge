import { useEffect } from "react";
import { useStore } from "@/store";
import { noteOff, noteOn } from "@/audio";
import {
  auditionEvent,
  defaultStep,
  materializePattern,
  patternLabels,
  type PatternContext
} from "@/audition-patterns";
import { AuditionControls } from "@/components/AuditionControls";
import { StepEditor } from "@/components/StepEditor";
import { StepGrid } from "@/components/StepGrid";

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
  const toggleStep = useStore((s) => s.toggleStep);
  const selectStep = useStore((s) => s.selectStep);
  const setStepNote = useStore((s) => s.setStepNote);
  const setStepVelocity = useStore((s) => s.setStepVelocity);
  const forkAuditionToCustomCopy = useStore((s) => s.forkAuditionToCustomCopy);
  const toggleCustomCopyStep = useStore((s) => s.toggleCustomCopyStep);
  const setCustomCopyStepNote = useStore((s) => s.setCustomCopyStepNote);
  const setCustomCopyStepVelocity = useStore((s) => s.setCustomCopyStepVelocity);

  const intervalMs = Math.max(20, Math.round(60_000 / (bpm * 4)));

  useEffect(() => {
    if (!playing) return;
    const noteOffTimers = new Set<number>();
    const activeNotes = new Set<number>();

    const tick = () => {
      const state = useStore.getState();
      const next = (state.playStep + 1) % state.audition.length;
      state.setPlayStep(next);
      const event = auditionEvent(state.audition.pattern, next, {
        steps: state.audition.pattern === "custom_copy" ? state.customCopySteps : state.steps,
        root: state.root,
        octave: state.octave,
        transpose: state.audition.transpose,
        velocity: state.audition.velocity
      });
      if (!event) return;

      if (activeNotes.has(event.note)) noteOff(event.note);
      activeNotes.add(event.note);
      void noteOn(event.note, event.velocity);
      const gateMs = Math.max(15, Math.round(intervalMs * Math.min(0.98, state.audition.gate) * event.gateSteps));
      const timer = window.setTimeout(() => {
        noteOff(event.note);
        activeNotes.delete(event.note);
        noteOffTimers.delete(timer);
      }, gateMs);
      noteOffTimers.add(timer);
    };

    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      clearInterval(id);
      for (const timer of noteOffTimers) clearTimeout(timer);
      for (const note of activeNotes) noteOff(note);
    };
  }, [playing, intervalMs]);

  const customCopyPattern = audition.pattern === "custom_copy";
  const customPattern = audition.pattern === "custom";
  const editablePattern = customPattern || customCopyPattern;
  const activeSteps = customCopyPattern ? customCopySteps : steps;
  const step = activeSteps[selectedStep] ?? defaultStep();
  const sourceSteps = editablePattern ? activeSteps : steps;
  const visibleSteps = Array.from({ length: audition.length }, (_, index) => sourceSteps[index] ?? defaultStep());
  const patternContext: PatternContext = {
    steps,
    root,
    octave,
    transpose: audition.transpose,
    velocity: audition.velocity
  };

  const forkGeneratedPattern = (index: number, toggleClickedStep: boolean) => {
    const forked = materializePattern(audition.pattern, patternContext);
    forkAuditionToCustomCopy(forked);
    selectStep(index);
    if (toggleClickedStep) toggleCustomCopyStep(index);
  };

  const onStepClick = (index: number, shiftKey: boolean) => {
    if (!editablePattern) return forkGeneratedPattern(index, !shiftKey);
    if (shiftKey) return selectStep(index);
    if (customCopyPattern) return toggleCustomCopyStep(index);
    return toggleStep(index);
  };

  return (
    <section className="rounded-md border border-line bg-panel-2 p-3">
      <AuditionControls intervalMs={intervalMs} />

      <div className="space-y-2">
        <StepGrid
          auditionGate={audition.gate}
          editablePattern={editablePattern}
          onStepClick={onStepClick}
          pattern={audition.pattern}
          patternContext={patternContext}
          playStep={playStep}
          selectedStep={selectedStep}
          visibleSteps={visibleSteps}
        />
        <p className="text-[11px] text-muted">
          {editablePattern ? "Click step to toggle · shift-click to select for editing" : "Click a generated step to fork it into Custom Copy"}
          {" · "}{patternLabels[audition.pattern]}
        </p>
      </div>

      <StepEditor
        customCopyPattern={customCopyPattern}
        editablePattern={editablePattern}
        selectedStep={selectedStep}
        setCustomCopyStepNote={setCustomCopyStepNote}
        setCustomCopyStepVelocity={setCustomCopyStepVelocity}
        setStepNote={setStepNote}
        setStepVelocity={setStepVelocity}
        step={step}
      />
    </section>
  );
}
