import { useStore, selectParamsForSelectedSlot, selectSelectedSlot } from "@/store";
import { Slider } from "@/components/ui/slider";

export function Controls() {
  const params = useStore(selectParamsForSelectedSlot);
  const slot = useStore(selectSelectedSlot);
  const trackIndex = useStore((s) => s.selectedTrack);
  const slotIndex = useStore((s) => s.selectedSlot);
  const setTopLevelParam = useStore((s) => s.setTopLevelParam);
  const setSlotParam = useStore((s) => s.setSlotParam);

  if (params.length === 0) {
    return (
      <div className="rounded-md border border-line bg-panel-2 p-4 text-sm text-muted">
        {slot.kind === "midi_fx" || slot.kind === "audio_fx"
          ? "Pick a module above to see its parameters."
          : "No parameters for this slot."}
      </div>
    );
  }

  const onChange = (key: string, value: number) => {
    if (slot.kind === "sound_generator") setTopLevelParam(key, value);
    else setSlotParam(trackIndex, slotIndex, key, value);
  };

  return (
    <div className="overflow-hidden rounded-md border border-line bg-panel-2">
      {params.map((p) => (
        <div
          key={p.key}
          className="grid grid-cols-[120px_1fr_auto] items-center gap-3 border-b border-line px-3 py-2 last:border-b-0"
        >
          <label className="truncate text-sm font-medium">{p.label}</label>
          <Slider
            value={[p.value]}
            min={p.min}
            max={p.max}
            step={p.step}
            onValueChange={(v) => onChange(p.key, v[0])}
          />
          <span className="w-12 text-right font-mono text-xs text-warn">{formatValue(p)}</span>
        </div>
      ))}
    </div>
  );
}

function formatValue(p: { key: string; value: number; step: number }): string {
  if (p.key === "transpose") return (p.value > 0 ? "+" : "") + p.value.toFixed(0);
  if (p.key === "receive_ch") return p.value === 0 ? "All" : p.value.toFixed(0);
  if (p.key === "forward_ch") {
    if (p.value === 0) return "Auto";
    if (p.value === 1) return "Thru";
    return `Ch ${(p.value - 1).toFixed(0)}`;
  }
  if (p.key === "midi_fx_output") return p.value < 0.5 ? "Schw" : "Both";
  if (p.step >= 1) return p.value.toFixed(0);
  return p.value.toFixed(2);
}
