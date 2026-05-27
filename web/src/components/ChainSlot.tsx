import { useStore } from "@/store";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ChainSlot as ChainSlotType } from "@/chain-state";

type Props = {
  slot: ChainSlotType;
  trackIndex: number;
  slotIndex: number;
};

const CLEAR = "__clear__";

export function ChainSlot({ slot, trackIndex, slotIndex }: Props) {
  const selected = useStore((s) => s.selectedSlot === slotIndex);
  const selectSlot = useStore((s) => s.selectSlot);
  const toggleBypass = useStore((s) => s.toggleSlotBypass);
  const setSlotModule = useStore((s) => s.setSlotModule);
  const setTopLevelModule = useStore((s) => s.setTopLevelModule);
  const moduleIndex = useStore((s) => s.moduleIndex);
  const topLevelModuleId = useStore((s) => s.moduleId);

  const isSettings = slot.kind === "settings";
  const dim = !isSettings && !slot.enabled;

  const handlePick = (v: string) => {
    if (slot.kind === "sound_generator") {
      void setTopLevelModule(v);
    } else {
      void setSlotModule(trackIndex, slotIndex, v === CLEAR ? null : v);
    }
  };

  return (
    <div
      onClick={() => selectSlot(slotIndex)}
      className={cn(
        "grid cursor-pointer grid-cols-[80px_1fr_auto] items-center gap-3 border-b border-line px-3 py-1.5 transition-colors",
        "hover:bg-panel-2/60",
        selected && "bg-[#2c4030] shadow-[inset_4px_0_0_var(--accent)]",
        dim && "opacity-60"
      )}
    >
      <span className="text-xs uppercase tracking-wide text-muted">{slot.type}</span>

      {isSettings ? (
        <b className="truncate text-sm">{slot.name}</b>
      ) : (
        <Picker slot={slot} moduleIndex={moduleIndex} topLevelModuleId={topLevelModuleId} onPick={handlePick} />
      )}

      {isSettings ? (
        <span className="text-xs text-muted">open</span>
      ) : (
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <span className="w-16 text-right text-xs text-muted">{slot.enabled ? "enabled" : "bypassed"}</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Switch
                checked={slot.enabled}
                onCheckedChange={() => toggleBypass(trackIndex, slotIndex)}
                aria-label={`Bypass ${slot.type}`}
              />
            </TooltipTrigger>
            <TooltipContent>{bypassExplanation(slot.kind, slot.enabled)}</TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

function Picker({
  slot,
  moduleIndex,
  topLevelModuleId,
  onPick
}: {
  slot: Exclude<ChainSlotType, { kind: "settings" }>;
  moduleIndex: ReturnType<typeof useStore.getState>["moduleIndex"];
  topLevelModuleId: string;
  onPick: (value: string) => void;
}) {
  const kindForFilter = slot.kind;
  const options = moduleIndex.filter((m) => (m.kind ?? "sound_generator") === kindForFilter);
  const value = slot.kind === "sound_generator" ? topLevelModuleId : slot.moduleId ?? "";
  const allowClear = slot.kind !== "sound_generator";

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <Select value={value} onValueChange={onPick}>
        <SelectTrigger className="h-8">
          <SelectValue placeholder="— Empty —" />
        </SelectTrigger>
        <SelectContent>
          {options.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-muted">No {labelForKind(slot.kind)} modules installed</div>
          ) : (
            <>
              {allowClear && slot.moduleId && <SelectItem value={CLEAR}>— Empty —</SelectItem>}
              {options.map((opt) => (
                <SelectItem key={opt.id} value={opt.id}>
                  {opt.name ?? opt.id}
                </SelectItem>
              ))}
            </>
          )}
        </SelectContent>
      </Select>
    </div>
  );
}

function labelForKind(kind: "midi_fx" | "sound_generator" | "audio_fx"): string {
  if (kind === "midi_fx") return "MIDI FX";
  if (kind === "audio_fx") return "Audio FX";
  return "Sound";
}

function bypassExplanation(kind: ChainSlotType["kind"], enabled: boolean): string {
  if (enabled) return "Click to bypass";
  if (kind === "midi_fx") return "Bypassed: MIDI passes through unchanged";
  if (kind === "sound_generator") return "Bypassed: synth is silent; downstream FX tails continue";
  if (kind === "audio_fx") return "Bypassed: audio passes through dry";
  return "";
}
