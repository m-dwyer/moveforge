import { useStore, selectCurrentTrack } from "@/store";
import { ChainSlot } from "./ChainSlot";

export function Chain() {
  const trackIndex = useStore((s) => s.selectedTrack);
  const chain = useStore((s) => selectCurrentTrack(s).chain);

  return (
    <div className="overflow-hidden rounded-md border border-line bg-panel-2">
      {chain.map((slot, i) => (
        <ChainSlot key={slot.id} slot={slot} trackIndex={trackIndex} slotIndex={i} />
      ))}
    </div>
  );
}
