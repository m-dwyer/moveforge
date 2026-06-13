import { cn } from "@/lib/utils";

export type MobileTab = "chain" | "params" | "play" | "sequence";

const TABS: Array<{ id: MobileTab; label: string }> = [
  { id: "chain", label: "Chain" },
  { id: "params", label: "Params" },
  { id: "play", label: "Play" },
  { id: "sequence", label: "Seq" }
];

export function MobileTabBar({
  active,
  onChange
}: {
  active: MobileTab;
  onChange: (tab: MobileTab) => void;
}) {
  return (
    <nav role="tablist" className="grid shrink-0 grid-cols-4 gap-1.5 border-t border-line bg-panel pt-2">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={active === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            "rounded border border-line bg-panel-2 px-3 py-2 text-sm transition-colors",
            "hover:border-accent/40",
            active === t.id && "border-accent bg-[#243527] text-text"
          )}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );
}
