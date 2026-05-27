import { useMemo } from "react";
import { useStore } from "@/store";
import { isInScale, isRoot, noteForPad, noteLabel, noteShortLabel } from "@/lib/pads";
import { noteOff, noteOn } from "@/audio";
import { cn } from "@/lib/utils";

export function PadGrid() {
  const padLayout = useStore((s) => s.padLayout);
  const root = useStore((s) => s.root);
  const scale = useStore((s) => s.scale);
  const octave = useStore((s) => s.octave);

  const notes = useMemo(
    () => Array.from({ length: 32 }, (_, i) => noteForPad(i, { padLayout, root, scale, octave })),
    [padLayout, root, scale, octave]
  );

  return (
    <div className="space-y-2">
      <div className="grid w-full grid-cols-8 gap-1.5">
        {notes.map((note, i) => (
          <Pad key={i} note={note} root={root} scale={scale} />
        ))}
      </div>
      <p className="text-[11px] text-muted">
        Keyboard: <kbd className="rounded bg-panel-2 px-1 font-mono">a–l</kbd> + black keys (w r t u i o) play first 16 pads ·{" "}
        <kbd className="rounded bg-panel-2 px-1 font-mono">space</kbd> play/stop sequencer
      </p>
    </div>
  );
}

function Pad({ note, root, scale }: { note: number; root: number; scale: "major" | "minor" | "pentatonic" }) {
  const root_ = isRoot(note, root);
  const inScale = isInScale(note, root, scale);
  return (
    <button
      type="button"
      data-testid="pad"
      data-note={note}
      title={noteLabel(note)}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const vel = e.pressure > 0 ? Math.max(0.25, Math.min(1, e.pressure)) : 0.94;
        void noteOn(note, vel);
        e.currentTarget.dataset.active = "1";
      }}
      onPointerUp={(e) => {
        noteOff(note);
        delete e.currentTarget.dataset.active;
      }}
      onPointerCancel={(e) => {
        noteOff(note);
        delete e.currentTarget.dataset.active;
      }}
      onPointerLeave={(e) => {
        if (e.currentTarget.dataset.active) {
          noteOff(note);
          delete e.currentTarget.dataset.active;
        }
      }}
      className={cn(
        "aspect-square rounded text-xs font-mono select-none transition-colors",
        "border border-line",
        inScale ? "bg-[#1f2a18] text-text" : "bg-panel-2 text-muted",
        root_ && "border-accent text-accent",
        "data-[active]:bg-accent data-[active]:text-bg active:scale-[0.97]"
      )}
    >
      {noteShortLabel(note)}
    </button>
  );
}
