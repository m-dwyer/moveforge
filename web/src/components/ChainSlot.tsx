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

export function ChainSlot({ slot, trackIndex, slotIndex }: Props) {
  const selected = useStore((s) => s.selectedSlot === slotIndex);
  const selectSlot = useStore((s) => s.selectSlot);
  const toggleBypass = useStore((s) => s.toggleSlotBypass);
  const setSlotModule = useStore((s) => s.setSlotModule);
  const moduleIndex = useStore((s) => s.moduleIndex);

  const isFxSlot = slot.kind === "midi_fx" || slot.kind === "audio_fx";
  const isSettings = slot.kind === "settings";
  const dim = !isSettings && !slot.enabled;

  const pickerOptions = isFxSlot ? moduleIndex.filter((m) => (m.kind ?? "sound_generator") === slot.kind) : [];
  const CLEAR = "__clear__";

  return (
    <div
      onClick={() => selectSlot(slotIndex)}
      className={cn(
        "grid cursor-pointer grid-cols-[110px_1fr_auto] items-center gap-3 border-b border-line px-3 py-2 transition-colors",
        "hover:bg-panel-2/60",
        selected && "bg-[#243527] shadow-[inset_3px_0_0_var(--accent)]",
        dim && "opacity-60"
      )}
    >
      <span className="text-xs uppercase tracking-wide text-muted">{slot.type}</span>

      {isFxSlot ? (
        <div onClick={(e) => e.stopPropagation()}>
          <Select
            value={slot.moduleId ?? ""}
            onValueChange={(v) => setSlotModule(trackIndex, slotIndex, v === CLEAR ? null : v)}
          >
            <SelectTrigger className="h-8">
              <SelectValue placeholder="— Empty —" />
            </SelectTrigger>
            <SelectContent>
              {pickerOptions.length === 0 ? (
                <div className="px-2 py-1.5 text-xs text-muted">No {slot.kind === "midi_fx" ? "MIDI FX" : "Audio FX"} modules installed</div>
              ) : (
                <>
                  {slot.moduleId && <SelectItem value={CLEAR}>— Empty —</SelectItem>}
                  {pickerOptions.map((opt) => (
                    <SelectItem key={opt.id} value={opt.id}>
                      {opt.name ?? opt.id}
                    </SelectItem>
                  ))}
                </>
              )}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <b className="truncate text-sm">{slot.name}</b>
      )}

      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {isSettings ? (
          <span className="text-xs text-muted">open</span>
        ) : (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}

function bypassExplanation(kind: ChainSlotType["kind"], enabled: boolean): string {
  if (enabled) return "Click to bypass";
  if (kind === "midi_fx") return "Bypassed: MIDI passes through unchanged";
  if (kind === "sound_generator") return "Bypassed: synth is silent; downstream FX tails continue";
  if (kind === "audio_fx") return "Bypassed: audio passes through dry";
  return "";
}
