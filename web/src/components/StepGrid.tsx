import { patternLabels, stepHasEvent, type PatternContext } from "@/audition-patterns";
import type { AuditionPatternName, StepState } from "@/chain-state";
import { noteLabel } from "@/lib/pads";
import { cn } from "@/lib/utils";

type Props = {
  auditionGate: number;
  editablePattern: boolean;
  onStepClick: (index: number, shiftKey: boolean) => void;
  pattern: AuditionPatternName;
  patternContext: PatternContext;
  playStep: number;
  selectedStep: number;
  visibleSteps: StepState[];
};

export function StepGrid({
  auditionGate,
  editablePattern,
  onStepClick,
  pattern,
  patternContext,
  playStep,
  selectedStep,
  visibleSteps
}: Props) {
  return (
    <div className="grid grid-cols-[repeat(8,minmax(0,1fr))] gap-1 sm:grid-cols-[repeat(16,minmax(0,1fr))]">
      {visibleSteps.map((step, index) => {
        const hasEvent = stepHasEvent(editablePattern, pattern, index, step, patternContext);
        return (
          <button
            key={index}
            type="button"
            onClick={(event) => onStepClick(index, event.shiftKey)}
            title={editablePattern
              ? `Step ${index + 1} · ${noteLabel(step.note)} · click toggle · shift-click select`
              : `Step ${index + 1} · ${patternLabels[pattern]} · click to make Custom Copy`}
            className={cn(
              "relative h-12 overflow-hidden rounded-sm border text-sm font-mono transition-colors sm:h-10",
              hasEvent ? "border-accent bg-[#243527] text-text" : "border-line bg-panel-2 text-muted",
              selectedStep === index && "ring-2 ring-warn ring-inset",
              playStep === index && "bg-accent text-bg"
            )}
          >
            {hasEvent && (
              <span
                aria-hidden="true"
                className="absolute inset-x-0 bottom-0 h-1 bg-accent/80"
                style={{ width: `${Math.max(5, auditionGate * 100)}%` }}
              />
            )}
            <span className="relative">{index + 1}</span>
          </button>
        );
      })}
    </div>
  );
}
