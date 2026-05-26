import { useMemo } from "react";
import { useStore, selectSelectedSlot, type SlotParamRow } from "@/store";
import { Slider } from "@/components/ui/slider";
import { audioFxParamDefs, midiFxParamDefs, settingsParamDefs, type ScopedParamDefinition } from "@/chain-state";

export function Controls() {
  const slot = useStore(selectSelectedSlot);
  const topLevelParams = useStore((s) => s.topLevelParams);
  const slotMetaEntry = useStore((s) => s.slotMeta[slot.id] ?? null);
  const trackIndex = useStore((s) => s.selectedTrack);
  const slotIndex = useStore((s) => s.selectedSlot);
  const setTopLevelParam = useStore((s) => s.setTopLevelParam);
  const setSlotParam = useStore((s) => s.setSlotParam);

  const params = useMemo<SlotParamRow[]>(() => {
    if (slot.kind === "sound_generator") {
      return topLevelParams.map((p) => ({
        key: p.key,
        label: p.label,
        min: p.min,
        max: p.max,
        step: p.step ?? 0.01,
        value: p.value
      }));
    }
    if (slot.kind === "settings") {
      return rowsFromDefs(settingsParamDefs, slot.params);
    }
    if (slotMetaEntry) {
      return slotMetaEntry.params.map((p) => ({
        key: p.key,
        label: p.label,
        min: p.min,
        max: p.max,
        step: p.step ?? 0.01,
        value: (slot.params as Record<string, number>)[p.key] ?? p.default
      }));
    }
    return rowsFromDefs(slot.kind === "midi_fx" ? midiFxParamDefs : audioFxParamDefs, slot.params as Record<string, number>);
  }, [slot, topLevelParams, slotMetaEntry]);

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

function rowsFromDefs(defs: ScopedParamDefinition[], values: Record<string, number>): SlotParamRow[] {
  return defs.map((def) => ({
    key: def.key,
    label: def.label,
    min: def.min,
    max: def.max,
    step: def.step ?? 0.01,
    value: values[def.key] ?? def.default
  }));
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
