import { useStore } from "@/store";
import { cn } from "@/lib/utils";

export function TrackBar() {
  const selectedTrack = useStore((s) => s.selectedTrack);
  const selectTrack = useStore((s) => s.selectTrack);

  return (
    <div className="grid grid-cols-4 gap-1.5">
      {[0, 1, 2, 3].map((i) => (
        <button
          key={i}
          type="button"
          onClick={() => selectTrack(i)}
          className={cn(
            "rounded border border-line bg-panel-2 px-3 py-1.5 text-sm transition-colors",
            "hover:border-accent/40",
            selectedTrack === i && "border-accent bg-[#243527] text-text"
          )}
        >
          Track {i + 1}
        </button>
      ))}
    </div>
  );
}
