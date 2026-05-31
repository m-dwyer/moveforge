import { useStore, selectSelectedSlot } from "@/store";
import { Chain } from "./Chain";
import { Controls } from "./Controls";
import { ParamSnapshots } from "./ParamSnapshots";
import { Presets } from "./Presets";
import { TrackBar } from "./TrackBar";

export function Panel() {
  const slot = useStore(selectSelectedSlot);
  return (
    <>
      <TrackBar />
      <Chain />
      {slot.kind !== "settings" && <Presets />}
      <ParamSnapshots />
      <Controls />
    </>
  );
}
