import type { StepState } from "@/chain-state";
import { Slider } from "@/components/ui/slider";
import { noteLabel } from "@/lib/pads";
import { cn } from "@/lib/utils";

type Props = {
  customCopyPattern: boolean;
  editablePattern: boolean;
  selectedStep: number;
  setCustomCopyStepNote: (index: number, note: number) => void;
  setCustomCopyStepVelocity: (index: number, velocity: number) => void;
  setStepNote: (index: number, note: number) => void;
  setStepVelocity: (index: number, velocity: number) => void;
  step: StepState;
};

export function StepEditor({
  customCopyPattern,
  editablePattern,
  selectedStep,
  setCustomCopyStepNote,
  setCustomCopyStepVelocity,
  setStepNote,
  setStepVelocity,
  step
}: Props) {
  return (
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
          onValueChange={(value) => customCopyPattern ? setCustomCopyStepNote(selectedStep, value[0]) : setStepNote(selectedStep, value[0])}
        />
        <span className="text-right font-mono text-warn">{noteLabel(step.note)}</span>

        <label>Vel</label>
        <Slider
          value={[step.velocity]}
          min={0}
          max={1}
          step={0.01}
          disabled={!editablePattern}
          onValueChange={(value) => customCopyPattern ? setCustomCopyStepVelocity(selectedStep, value[0]) : setStepVelocity(selectedStep, value[0])}
        />
        <span className="text-right font-mono text-warn">{step.velocity.toFixed(2)}</span>
      </div>
    </div>
  );
}
