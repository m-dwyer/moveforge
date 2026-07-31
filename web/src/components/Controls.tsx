import { useMemo, useState } from "react";
import { trackSlotKey, useStore, selectSelectedSlot, type SlotParamRow } from "@/store";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { settingsParamDefs, type ScopedParamDefinition } from "@/chain-state";
import { formatParamValue } from "../../../shared/param-format.ts";

export function Controls() {
  const slot = useStore(selectSelectedSlot);
  const topLevelParams = useStore((s) => s.topLevelParams);
  const trackIndex = useStore((s) => s.selectedTrack);
  const slotMetaEntry = useStore((s) => s.slotMeta[trackSlotKey(trackIndex, slot.id)] ?? null);
  const slotIndex = useStore((s) => s.selectedSlot);
  const setTopLevelParam = useStore((s) => s.setTopLevelParam);
  const setSlotParam = useStore((s) => s.setSlotParam);
  /* Collapsed rather than expanded state, so a module whose levels this component
   * has never seen opens expanded — which is what every single-level module in the
   * tree wants, and it keeps the empty set meaning "unchanged". */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleGroup = (group: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(group)) next.add(group);
      return next;
    });

  const params = useMemo<SlotParamRow[]>(() => {
    if (slot.kind === "sound_generator") {
      return topLevelParams.map((p) => ({
        group: p.group,
        groupLabel: p.groupLabel,
        key: p.key,
        label: p.label,
        min: p.min,
        max: p.max,
        description: p.description,
        display_format: p.display_format,
        step: p.step ?? 0.01,
        type: p.type,
        unit: p.unit,
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
        description: p.description,
        display_format: p.display_format,
        step: p.step ?? 0.01,
        type: p.type,
        unit: p.unit,
        value: (slot.params as Record<string, number>)[p.key] ?? p.default
      }));
    }
    return [];
  }, [slot, topLevelParams, slotMetaEntry]);

  if (params.length === 0) {
    return (
      <div data-testid="controls" className="rounded-md border border-line bg-panel-2 p-4 text-sm text-muted">
        {slot.kind === "midi_fx" || slot.kind === "audio_fx"
          ? "Pick a module above to see its parameters."
          : "No parameters for this slot."}
      </div>
    );
  }

  const onChange = (key: string, value: number) => {
    if (slot.kind === "sound_generator") {
      setTopLevelParam(key, value);
      return;
    }
    setSlotParam(trackIndex, slotIndex, key, value);
  };

  /* One section per `ui_hierarchy` level. 62 undivided sliders is ~1600 px of
   * unbroken list and the browser is where the sound design actually happens —
   * without the headers there is nothing to tell you that rows 9-16 are a
   * different voice from rows 1-8. Modules that declare a single level (every
   * other one in the tree) render exactly as before. */
  const sections = groupRows(params);
  const grouped = sections.length > 1;

  return (
    <TooltipProvider delayDuration={250}>
      <div data-testid="controls" className="shrink-0 overflow-hidden rounded-md border border-line bg-panel-2">
        {grouped && (
          <div className="flex items-center justify-end gap-1.5 border-b border-line bg-panel px-2.5 py-1">
            <button type="button" className="text-xs text-muted hover:text-text"
                    onClick={() => setCollapsed(new Set())}>Expand all</button>
            <span className="text-xs text-muted">/</span>
            <button type="button" className="text-xs text-muted hover:text-text"
                    onClick={() => setCollapsed(new Set(sections.map((s) => s.group)))}>Collapse all</button>
          </div>
        )}
        {sections.map((section) => (
          <div key={section.group}>
            {grouped && (
              <button
                type="button"
                data-testid="param-group-header"
                aria-expanded={!collapsed.has(section.group)}
                onClick={() => toggleGroup(section.group)}
                className="flex w-full items-center gap-1.5 border-b border-line bg-panel px-2.5 py-1 text-left text-xs font-semibold uppercase tracking-wide text-muted hover:text-text"
              >
                <span className="inline-block w-3 font-mono">{collapsed.has(section.group) ? "+" : "−"}</span>
                {section.label}
                <span className="ml-auto font-mono normal-case tracking-normal opacity-60">
                  {section.rows.length}
                </span>
              </button>
            )}
            <div className={collapsed.has(section.group) ? "hidden" : "grid xl:grid-cols-2"}>
              {section.rows.map((p) => (
                <div
                  key={p.key}
                  className="grid min-h-9 grid-cols-[minmax(84px,1fr)_2fr_44px] items-center gap-2 border-b border-line px-2.5 py-1.5"
                >
                  <ParamLabel param={p} shortLabel={shortLabel(p, section.label)} />
                  <Slider
                    value={[p.value]}
                    min={p.min}
                    max={p.max}
                    step={p.step}
                    onValueChange={(v) => onChange(p.key, v[0])}
                  />
                  <span className="w-11 text-right font-mono text-xs text-warn">{formatValue(p)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </TooltipProvider>
  );
}

type ParamSection = { group: string; label: string; rows: SlotParamRow[] };

function groupRows(params: SlotParamRow[]): ParamSection[] {
  const sections: ParamSection[] = [];
  for (const p of params) {
    const group = p.group ?? "";
    const last = sections[sections.length - 1];
    if (last && last.group === group) {
      last.rows.push(p);
      continue;
    }
    sections.push({ group, label: p.groupLabel ?? group, rows: [p] });
  }
  return sections;
}

/* "Hat Tune" under a "1 Hat" header is just "Tune". Six voices' worth of repeated
 * prefixes is what pushed every label past the column and left the grid reading
 * "OpenHat ..." twice in a row with no way to tell which control was which. */
function shortLabel(param: SlotParamRow, sectionLabel: string): string {
  const prefix = sectionLabel.replace(/^\d+\s+/, "").trim();
  if (!prefix || param.label === prefix) return param.label;
  return param.label.startsWith(`${prefix} `) ? param.label.slice(prefix.length + 1) : param.label;
}

function ParamLabel({ param, shortLabel }: { param: SlotParamRow; shortLabel?: string }) {
  const text = shortLabel ?? param.label;
  const label = <span className="truncate text-sm font-medium">{text}</span>;
  /* `title` on every label, not only the ones with a description: the column can
   * still be too narrow at some widths, and a truncated name with no way to read
   * it in full is how you end up adjusting the wrong control. */
  if (!param.description) return <label className="truncate" title={param.label}>{label}</label>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <label className="cursor-help truncate decoration-dotted underline-offset-4 hover:underline"
               title={param.label}>
          {label}
        </label>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-64 leading-snug">
        {param.description}
      </TooltipContent>
    </Tooltip>
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

/* The `slot:` and transport keys are the browser's own controls, not module
 * parameters — they have no module.json entry and so no unit, and their
 * renderings ("Thru", "All", "Off") are not numbers at all. They stay here.
 * Everything below them is a real parameter, so it formats the way the device
 * formats it, falling back to the old step-based rule when it carries no unit. */
function formatValue(p: SlotParamRow & { value: number }): string {
  if (p.key === "transpose") return (p.value > 0 ? "+" : "") + p.value.toFixed(0);
  if (p.key === "slot:muted" || p.key === "slot:soloed" || p.key.endsWith(":enabled")) {
    return p.value < 0.5 ? "Off" : "On";
  }
  if (p.key === "slot:volume") return `${Math.round(p.value * 100)}%`;
  if (p.key === "slot:receive_channel") return p.value === 0 ? "All" : p.value.toFixed(0);
  if (p.key === "slot:forward_channel") {
    if (p.value === -2) return "Thru";
    if (p.value === -1) return "Auto";
    return `Ch ${(p.value + 1).toFixed(0)}`;
  }
  if (p.key === "midi_fx_pre_mode") return p.value < 0.5 ? "Post" : "Pre";
  if (p.key === "lfo1:depth" || p.key === "lfo2:depth") return `${Math.round(p.value * 100)}%`;

  const formatted = formatParamValue(p.value, p);
  if (formatted !== null) return formatted;

  if (p.step >= 1) return p.value.toFixed(0);
  return p.value.toFixed(2);
}
