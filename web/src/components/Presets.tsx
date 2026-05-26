import { useStore } from "@/store";
import { cn } from "@/lib/utils";

export function Presets() {
  const presets = useStore((s) => s.presets);
  const selected = useStore((s) => s.selectedPreset);
  const apply = useStore((s) => s.applyPreset);

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
