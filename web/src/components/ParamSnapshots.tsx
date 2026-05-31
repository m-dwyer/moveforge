import { useMemo } from "react";
import {
  PARAM_SNAPSHOT_LABELS,
  trackSlotKey,
  useStore,
  selectSelectedSlot,
  type ParamSnapshotLabel
} from "@/store";
import { cn } from "@/lib/utils";

const EMPTY_BANK = {};
const EMPTY_PARAMS = {};

export function ParamSnapshots() {
  const slot = useStore(selectSelectedSlot);
  const trackIndex = useStore((s) => s.selectedTrack);
  const slotIndex = useStore((s) => s.selectedSlot);
  const topLevelParams = useStore((s) => s.topLevelParams);
  const slotMetaEntry = useStore((s) => s.slotMeta[trackSlotKey(trackIndex, slot.id)] ?? null);
  const snapshotBank = useStore((s) => s.paramSnapshots[snapshotKey(trackIndex, slot)]);
  const selected = useStore((s) => s.selectedParamSnapshot[snapshotKey(trackIndex, slot)] ?? "A");
  const selectParamSnapshot = useStore((s) => s.selectParamSnapshot);
  const captureParamSnapshot = useStore((s) => s.captureParamSnapshot);
  const recallParamSnapshot = useStore((s) => s.recallParamSnapshot);
  const swapParamSnapshot = useStore((s) => s.swapParamSnapshot);
  const clearParamSnapshot = useStore((s) => s.clearParamSnapshot);

  const bank = snapshotBank ?? EMPTY_BANK;
  const liveParams = useMemo(() => {
    if (slot.kind === "settings") return EMPTY_PARAMS;
    if (slot.kind === "sound_generator") {
      return Object.fromEntries(topLevelParams.map((param) => [param.key, param.value]));
    }
    return { ...(slot.params as Record<string, number>) };
  }, [slot, topLevelParams]);

  if (slot.kind === "settings") return null;
  if (slot.kind !== "sound_generator" && !slotMetaEntry) return null;

  const hasParams = Object.keys(liveParams).length > 0;
  const selectedSnapshot = bank[selected];
  const selectedHasSnapshot = selectedSnapshot !== undefined;

  const choose = (label: ParamSnapshotLabel) => {
    selectParamSnapshot(label);
    if (bank[label]) recallParamSnapshot(label);
  };

  return (
    <div data-testid="param-snapshots" className="flex flex-wrap items-center gap-1.5 rounded-md border border-line bg-panel-2 p-2">
      <span className="mr-1 text-xs font-medium text-muted">Snapshots</span>
      {PARAM_SNAPSHOT_LABELS.map((label) => {
        const snapshot = bank[label];
        const filled = snapshot !== undefined;
        const matches = filled && paramsMatch(liveParams, snapshot);
        return (
          <button
            key={label}
            type="button"
            onClick={() => choose(label)}
            className={cn(
              "h-7 w-8 rounded border text-xs font-semibold transition-colors",
              "hover:border-accent/50",
              selected === label ? "border-warn text-warn" : "border-line text-muted",
              matches && "border-accent bg-[#243527] text-text",
              !filled && "border-dashed"
            )}
            title={filled ? `Recall snapshot ${label}` : `Select empty snapshot ${label}`}
          >
            {label}
          </button>
        );
      })}
      <button
        type="button"
        disabled={!hasParams}
        onClick={() => captureParamSnapshot(selected)}
        className="h-7 rounded border border-line bg-bg px-2 text-xs font-medium text-text transition-colors hover:border-accent/50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Capture
      </button>
      <button
        type="button"
        disabled={!selectedHasSnapshot}
        onClick={() => swapParamSnapshot(selected)}
        className="h-7 rounded border border-line bg-bg px-2 text-xs font-medium text-text transition-colors hover:border-accent/50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Swap
      </button>
      <button
        type="button"
        disabled={!selectedHasSnapshot}
        onClick={() => clearParamSnapshot(selected)}
        className="h-7 rounded border border-line bg-bg px-2 text-xs font-medium text-muted transition-colors hover:border-red-500/50 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Clear
      </button>
    </div>
  );
}

function snapshotKey(trackIndex: number, slot: ReturnType<typeof selectSelectedSlot>): string {
  if (slot.kind === "settings" || !slot.moduleId) return "";
  return `${trackIndex}:${slot.id}:${slot.moduleId}`;
}

function paramsMatch(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = Object.keys(a);
  if (keys.length === 0) return false;
  return keys.every((key) => Math.abs((a[key] ?? NaN) - (b[key] ?? NaN)) < 0.000001);
}
