import { useStore } from "@/store";
import {
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
