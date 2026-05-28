import { useStore, selectSelectedSlot } from "@/store";
import { cn } from "@/lib/utils";

export function Presets() {
  const slot = useStore(selectSelectedSlot);
  const trackIndex = useStore((s) => s.selectedTrack);
  const slotIndex = useStore((s) => s.selectedSlot);

  // The sound_generator slot uses the top-level module presets; every other
  // module slot (audio_fx / midi_fx) uses the presets loaded into slotMeta.
  const isSound = slot.kind === "sound_generator";
  const topLevelPresets = useStore((s) => s.presets);
  const slotPresets = useStore((s) => s.slotMeta[slot.id]?.presets ?? null);
  const selectedTopLevel = useStore((s) => s.selectedPreset);
  const selectedSlot = useStore((s) => s.slotPreset[slot.id]);
  const applyTopLevel = useStore((s) => s.applyPreset);
  const applySlot = useStore((s) => s.applySlotPreset);

  const presets = isSound ? topLevelPresets : slotPresets ?? [];
  const selected = isSound ? selectedTopLevel : selectedSlot;
  const apply = isSound
    ? applyTopLevel
    : (name: string) => applySlot(trackIndex, slotIndex, name);

  if (presets.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {presets.map((p) => (
        <button
          key={p.name}
          type="button"
          onClick={() => apply(p.name)}
          className={cn(
            "rounded border border-line bg-panel-2 px-3 py-1.5 text-xs font-medium transition-colors",
            "hover:border-accent/40",
            selected === p.name && "border-accent bg-[#243527] text-text"
          )}
        >
          {p.name}
        </button>
      ))}
    </div>
  );
}
