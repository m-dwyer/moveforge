import { useStore, selectSelectedSlot } from "@/store";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Chain } from "./Chain";
import { Controls } from "./Controls";
import { TrackBar } from "./TrackBar";

export function Panel() {
  const moduleIndex = useStore((s) => s.moduleIndex);
  const moduleId = useStore((s) => s.moduleId);
  const setTopLevelModule = useStore((s) => s.setTopLevelModule);
  const activeModuleName = useStore((s) => s.activeModuleName);
  const selectedTrack = useStore((s) => s.selectedTrack);
  const slot = useStore(selectSelectedSlot);
  const error = useStore((s) => s.error);

  const soundModules = moduleIndex.filter((m) => (m.kind ?? "sound_generator") === "sound_generator");

  return (
    <section className="flex flex-col gap-4 p-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{activeModuleName} Parameters</h1>
        <p className="text-sm text-muted">
          Track {selectedTrack + 1} / {slot.type}
        </p>
      </header>

      {error && (
        <div className="rounded border border-red-700 bg-red-950/40 px-3 py-2 text-sm text-red-200">{error}</div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Module
          <Select value={moduleId} onValueChange={(v) => setTopLevelModule(v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {soundModules.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name ?? m.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>

      <TrackBar />

      <Chain />

      <Controls />
    </section>
  );
}
