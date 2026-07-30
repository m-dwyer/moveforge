import { useMemo } from "react";
import { moduleNoteRoot, moduleVoiceLabels, useStore } from "@/store";
import { isInScale, isRoot, noteForPad, noteLabel, noteShortLabel } from "@/lib/pads";
import { noteOff, noteOn } from "@/audio";
import { cn } from "@/lib/utils";
import { OctaveButtons } from "./OctaveButtons";
import type { ScaleName } from "@/chain-state";

export function PadGrid({ rows = 4 }: { rows?: 1 | 4 }) {
  const padLayout = useStore((s) => s.padLayout);
  const root = useStore((s) => s.root);
  const scale = useStore((s) => s.scale);
  const octave = useStore((s) => s.octave);
  const moduleRoot = useStore(moduleNoteRoot);
  /* Derived with useMemo, not as a store selector: moduleVoiceLabels builds a
   * fresh array on every call, so zustand's reference check never settles and
   * the component re-renders until React gives up with "maximum update depth
   * exceeded". topLevelParams is a stable reference between edits, so this is. */
  const topLevelParams = useStore((s) => s.topLevelParams);
  const voiceLabels = useMemo(() => moduleVoiceLabels({ topLevelParams }), [topLevelParams]);
  const count = rows * 8;
  /* Only in Kit layout. The melodic layouts stagger rows by fourths or octaves,
   * so a pad's note is the point and its voice name would be noise. */
  const kit = padLayout === "kit";

  const notes = useMemo(
    () => Array.from({ length: count },
                     (_, i) => noteForPad(i, { padLayout, root, scale, octave, moduleRoot })),
    [padLayout, root, scale, octave, moduleRoot, count]
  );

  return (
    <div className="space-y-2">
      <div className="grid w-full grid-cols-8 gap-1.5">
        {notes.map((note, i) => (
          <Pad key={i} index={i} note={note} root={root} scale={scale}
               voice={kit ? voiceLabels[note - (moduleRoot ?? note)] : undefined}
               mapped={!kit || voiceLabels.length === 0
                       || note - (moduleRoot ?? note) < voiceLabels.length} />
        ))}
      </div>
      {rows === 1 && <OctaveButtons />}
      <p className="text-[11px] text-muted">
        Keyboard: <kbd className="rounded bg-panel-2 px-1 font-mono">a–l</kbd> + black keys (w r t u i o) play first 16 pads ·{" "}
        <kbd className="rounded bg-panel-2 px-1 font-mono">space</kbd> play/stop sequencer
      </p>
    </div>
  );
}

function Pad({ index, note, root, scale, voice, mapped }: {
  index: number; note: number; root: number; scale: ScaleName;
  voice?: string; mapped: boolean;
}) {
  const active = useStore((s) => (s.activePads.get(index) ?? 0) > 0);
  const setPadActive = useStore((s) => s.setPadActive);
  const root_ = isRoot(note, root);
  const inScale = isInScale(note, root, scale);
  return (
    <button
      type="button"
      data-testid="pad"
      data-note={note}
      data-active={active ? "true" : undefined}
      title={voice ? `${voice} · ${noteLabel(note)}` : noteLabel(note)}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const vel = e.pressure > 0 ? Math.max(0.25, Math.min(1, e.pressure)) : 0.94;
        setPadActive(index, true);
        void noteOn(note, vel);
      }}
      onPointerUp={(e) => {
        noteOff(note);
        setPadActive(index, false);
      }}
      onPointerCancel={(e) => {
        noteOff(note);
        setPadActive(index, false);
      }}
      onPointerLeave={(e) => {
        if (active) {
          noteOff(note);
          setPadActive(index, false);
        }
      }}
      className={cn(
        "aspect-square rounded text-xs font-mono select-none transition-colors",
        "border border-line",
        inScale ? "bg-[#1f2a18] text-text" : "bg-panel-2 text-muted",
        root_ && "border-accent text-accent",
        /* A pad past the last voice triggers nothing. Leaving it looking like the
         * others is how a six-voice module reads as an eight-voice one with two
         * broken pads. */
        !mapped && "opacity-30",
        "data-[active]:bg-accent data-[active]:text-bg active:scale-[0.97]"
      )}
    >
      {voice ? (
        <span className="block px-0.5 text-[10px] leading-tight break-words">{voice}</span>
      ) : (
        noteShortLabel(note)
      )}
    </button>
  );
}
